"""Start the local plan2run app, including accounts, activities and friends."""
import argparse
from collections import defaultdict, deque
from contextlib import closing
from functools import partial
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlsplit

import database as store
from database import RequestError

BASE=Path(__file__).resolve().parent
auth_attempts=defaultdict(deque)
attempt_lock=Lock()


class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,".mjs":"text/javascript",".js":"text/javascript"}

    def send_head(self):
        # Cached modules may carry an old MIME type from a previous server.
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.api("GET")
        else:
            super().do_GET()

    def do_POST(self):
        self.api("POST")

    def answer(self,status,data,content_type="application/json; charset=utf-8",cookie=None):
        body=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type",content_type)
        self.send_header("Content-Length",str(len(body)))
        if cookie is not None:
            age=2592000 if cookie else 0
            self.send_header("Set-Cookie",f"p2r_session={cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}")
        self.end_headers()
        self.wfile.write(body)

    def params(self):
        if self.headers.get_content_type()!="application/json":
            raise RequestError("JSON verwacht.",415)
        origin=self.headers.get("Origin")
        if origin and urlsplit(origin).netloc!=self.headers.get("Host"):
            raise RequestError("Ongeldige herkomst.",403)
        size=int(self.headers.get("Content-Length","0"))
        if not 0<size<=5_000_000:
            raise RequestError("Verzoek te groot of leeg.",413)
        data=json.loads(self.rfile.read(size))
        if not isinstance(data,dict):
            raise RequestError("Ongeldige gegevens.")
        return data

    def api(self,method):
        path=urlsplit(self.path)
        route=path.path.removeprefix("/api/")
        q={k:v[0] for k,v in parse_qs(path.query).items()}
        try:
            data=self.params() if method=="POST" else {}
            cookie=SimpleCookie(self.headers.get("Cookie",""))
            token=cookie["p2r_session"].value if "p2r_session" in cookie else ""
            with closing(store.connect(self.server.db_path)) as db, db:
                if method=="POST":
                    db.execute("BEGIN IMMEDIATE")
                user=db.execute("""SELECT u.id,u.name,u.handle,u.kind FROM sessions s JOIN users u ON u.id=s.user
                    WHERE s.token=? AND s.expires>?""",(store.token_hash(token),store.now())).fetchone()
                if method=="POST" and route in ("login","signup","demo"):
                    ip=self.client_address[0]; tick=store.now()
                    with attempt_lock:
                        queue=auth_attempts[ip]
                        while queue and queue[0]<tick-300000:
                            queue.popleft()
                        if len(queue)>=40:
                            raise RequestError("Probeer het over enkele minuten opnieuw.",429)
                        queue.append(tick)
                    if route=="login": uid=store.login(db,data)
                    elif route=="signup": uid=store.register(db,data)
                    else: uid=store.demo(db)
                    db.execute("DELETE FROM sessions WHERE token=?",(store.token_hash(token),))
                    issued=store.issue_session(db,uid)
                    db.commit()
                    self.answer(200,{"ok":True},cookie=issued)
                    return
                if not user:
                    raise RequestError("Log in om verder te gaan.",401)
                uid=user["id"]
                if self.headers.get("X-Player",str(uid))!=str(uid):
                    raise RequestError("Je bent van account gewisseld. Vernieuw deze pagina.",409)
                if method=="GET":
                    if route=="me": result=store.self_state(db,user)
                    elif route=="friends": result=store.social(db,user,q.get("q","")[:60])
                    elif route=="clip":
                        row=db.execute("SELECT audio,mime FROM activities WHERE user=? AND id=?",(uid,q["id"])).fetchone()
                        if not row or not row["audio"]: raise RequestError("Geen opname gevonden.",404)
                        self.answer(200,row["audio"],row["mime"]);return
                    else: raise RequestError("Niet gevonden.",404)
                elif route=="logout":
                    db.execute("DELETE FROM sessions WHERE token=?",(store.token_hash(token),))
                    db.commit();self.answer(200,{"ok":True},cookie="");return
                elif route=="friend":
                    store.friend_action(db,user,int(data["id"]),data["action"]);result={"ok":True}
                elif route in ("activity","import-activity"):
                    result=store.save_run(db,user,data,legacy=route=="import-activity")
                elif route=="note":
                    store.save_note(db,uid,data);result={"ok":True}
                elif route=="sharing":
                    db.execute("UPDATE activities SET shared=? WHERE user=? AND id=?",(int(data["shared"] is True),uid,data["id"]))
                    result={"ok":True}
                else:
                    raise RequestError("Niet gevonden.",404)
                db.commit()
            self.answer(200,result)
        except RequestError as exc:
            self.answer(exc.status,{"error":str(exc)})
        except (KeyError,ValueError,TypeError,OverflowError):
            self.answer(400,{"error":"Controleer de ingevulde gegevens."})
        except Exception:
            import traceback
            traceback.print_exc()
            self.answer(500,{"error":"Bewaren of ophalen lukte niet. Probeer het opnieuw."})


def serve(port,db_path,host="127.0.0.1"):
    store.initialize(db_path)
    handler=partial(Handler,directory=str(BASE/"dist"))
    with ThreadingHTTPServer((host,port),handler) as server:
        server.db_path=db_path
        print(f"plan2run: http://{host}:{server.server_port}",flush=True)
        server.serve_forever()


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--port",type=int,default=8000)
    parser.add_argument("--host",default="127.0.0.1")
    parser.add_argument("--db",type=Path,default=BASE/"data"/"plan2run.sqlite3")
    args=parser.parse_args()
    try: serve(args.port,args.db,args.host)
    except KeyboardInterrupt: pass

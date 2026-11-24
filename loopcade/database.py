import base64
import hashlib
import hmac
import json
import math
import re
import secrets
import sqlite3
import time
from pathlib import Path

import calendar
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    BRUSSELS = ZoneInfo("Europe/Brussels")
except ZoneInfoNotFoundError:
    BRUSSELS = None


def week_key(timestamp, offset=0):
    instant = datetime.fromtimestamp(timestamp / 1000, timezone.utc)
    if BRUSSELS:
        local = instant.astimezone(BRUSSELS)
    else:
        # Windows Python may have no IANA database. EU transitions are at 01:00 UTC.
        def transition(month):
            last = datetime(instant.year, month, calendar.monthrange(instant.year, month)[1], 1, tzinfo=timezone.utc)
            return last - timedelta(days=(last.weekday() + 1) % 7)
        local = instant + timedelta(hours=2 if transition(3) <= instant < transition(10) else 1)
    return (local.date() - timedelta(days=local.weekday()) + timedelta(weeks=offset)).isoformat()


ROOT=Path(__file__).resolve().parent
DAY=86_400_000
SCHEMA="""
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, handle TEXT UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
 password TEXT, kind TEXT NOT NULL DEFAULT 'user'
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user INTEGER NOT NULL REFERENCES users, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS friends (
 lo INTEGER REFERENCES users, hi INTEGER REFERENCES users, sender INTEGER REFERENCES users,
 accepted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(lo,hi), CHECK(lo<hi)
);
CREATE TABLE IF NOT EXISTS activities (
 user INTEGER REFERENCES users, id TEXT, end INTEGER NOT NULL, body TEXT NOT NULL,
 shared INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', audio BLOB, mime TEXT, PRIMARY KEY(user,id)
);
CREATE INDEX IF NOT EXISTS recent_activities ON activities(user,end DESC);
"""


class RequestError(Exception):
    def __init__(self,message,status=400):
        super().__init__(message)
        self.status=status


def now():
    return int(time.time()*1000)


def connect(path):
    db=sqlite3.connect(path,timeout=10)
    db.row_factory=sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def initialize(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    db=connect(path)
    try:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(SCHEMA)
        with db:
            for handle,name in (("noor.demo","Noor"),("milan.demo","Milan"),("yara.demo","Yara"),("lou.demo","Lou")):
                db.execute("INSERT OR IGNORE INTO users(handle,name,kind) VALUES(?,?,'bot')",(handle,name))
            seed_examples(db)
    finally:
        db.close()


def hash_password(password,salt=None):
    salt=salt or secrets.token_hex(16)
    digest=hashlib.pbkdf2_hmac("sha256",password.encode(),bytes.fromhex(salt),600000).hex()
    return salt+"."+digest


def text_field(data,key,minimum,maximum):
    value=data.get(key)
    if not isinstance(value,str) or not minimum<=len(value.strip())<=maximum:
        raise RequestError(f"Controleer het veld {key}.")
    return value.strip()


def register(db,data):
    name=text_field(data,"naam",2,36)
    handle=text_field(data,"gebruikersnaam",3,24).lower()
    password=data.get("wachtwoord")
    if not re.fullmatch(r"[a-z0-9_]{3,24}",handle):
        raise RequestError("Gebruik 3 tot 24 letters, cijfers of underscores voor je gebruikersnaam.")
    if not isinstance(password,str) or not 8<=len(password)<=200:
        raise RequestError("Kies een wachtwoord van minstens 8 en maximaal 200 tekens.")
    try:
        return db.execute("INSERT INTO users(handle,name,password) VALUES(?,?,?)",(handle,name,hash_password(password))).lastrowid
    except sqlite3.IntegrityError:
        raise RequestError("Deze gebruikersnaam is al bezet.",409)


def login(db,data):
    handle=text_field(data,"gebruikersnaam",1,64)
    password=data.get("wachtwoord")
    if not isinstance(password,str) or len(password)>200:
        raise RequestError("Gebruikersnaam of wachtwoord klopt niet.",401)
    row=db.execute("SELECT id,password FROM users WHERE handle=? AND kind='user'",(handle,)).fetchone()
    stored=row["password"] if row else "00"*16+"."+"00"*32
    valid=hmac.compare_digest(stored,hash_password(password,stored.split(".")[0]))
    if not valid or not row:
        raise RequestError("Gebruikersnaam of wachtwoord klopt niet.",401)
    return row["id"]


def issue_session(db,uid):
    token=secrets.token_urlsafe(32)
    db.execute("DELETE FROM sessions WHERE expires<=?",(now(),))
    db.execute("INSERT INTO sessions VALUES(?,?,?)",(token_hash(token),uid,now()+30*DAY))
    return token


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def self_state(db,user):
    return {"user":dict(user),"activities":[own_activity(row) for row in db.execute(
        "SELECT id,end,body,shared,note,audio IS NOT NULL AS voice FROM activities WHERE user=? ORDER BY end DESC",(user["id"],))]}


def own_activity(row):
    return {**json.loads(row["body"]),"id":row["id"],"end":row["end"],"shared":bool(row["shared"]),
            "note":row["note"],"voice":bool(row["voice"])}


def relation(db,a,b):
    return db.execute("SELECT * FROM friends WHERE lo=? AND hi=?",sorted((a,b))).fetchone()


def friend_action(db,user,target,action):
    uid=user["id"]
    other=db.execute("SELECT id,kind FROM users WHERE id=?",(target,)).fetchone()
    if not other or target==uid or other["kind"]=="guest" or (user["kind"]=="guest" and other["kind"]!="bot"):
        raise RequestError("Speler niet beschikbaar.",404)
    lo,hi=sorted((uid,target))
    link=relation(db,uid,target)
    if action=="request":
        if not link:
            db.execute("INSERT INTO friends VALUES(?,?,?,?)",(lo,hi,uid,int(other["kind"]=="bot")))
        elif link["sender"]!=uid:
            db.execute("UPDATE friends SET accepted=1 WHERE lo=? AND hi=?",(lo,hi))
    elif action in ("accept","decline") and link and not link["accepted"] and link["sender"]==target:
        if action=="accept":
            db.execute("UPDATE friends SET accepted=1 WHERE lo=? AND hi=?",(lo,hi))
        else:
            db.execute("DELETE FROM friends WHERE lo=? AND hi=?",(lo,hi))
    else:
        raise RequestError("Dit verzoek is al verwerkt.",409)


def social(db,user,query=""):
    uid=user["id"]
    people=[dict(r) for r in db.execute("""SELECT u.id,u.name,u.handle,u.kind,f.accepted,f.sender FROM friends f
        JOIN users u ON u.id=CASE WHEN lo=? THEN hi ELSE lo END WHERE lo=? OR hi=? ORDER BY u.name""",(uid,uid,uid))]
    search=("%"+query.lower().replace("!","!!").replace("%","!%").replace("_","!_")+"%")
    suggestions=[dict(r) for r in db.execute("""SELECT id,name,handle,kind FROM users u WHERE id<>? AND kind<>'guest'
      AND (?<>'guest' OR kind='bot') AND (?<>'' OR kind='bot')
      AND (lower(name) LIKE ? ESCAPE '!' OR handle LIKE ? ESCAPE '!')
      AND NOT EXISTS (SELECT 1 FROM friends f WHERE lo=min(u.id,?) AND hi=max(u.id,?))
      ORDER BY name LIMIT 15""",(uid,user["kind"],query,search,search,uid,uid))]
    confirmed=[p["id"] for p in people if p["accepted"]]
    ids=confirmed+[uid]
    ranks={pid:0 for pid in ids}
    feed=[]
    placeholders=",".join("?" for _ in ids)
    rows=db.execute(f"""SELECT a.user,a.end,a.body,u.name FROM activities a JOIN users u ON u.id=a.user
                  WHERE a.user IN ({placeholders}) AND (a.shared OR a.user=?) ORDER BY a.end DESC""",(*ids,uid))
    current=week_key(now())
    for row in rows:
        week=week_key(row["end"])
        if week!=current and len(feed)>=40:
            break
        body=json.loads(row["body"])
        if week==current:
            ranks[row["user"]]+=body["points"]
        if row["user"]!=uid and len(feed)<40:
            feed.append({k:body[k] for k in ("mode","meters","elapsed","points")}|{"end":row["end"],"name":row["name"],"lines":body.get("lines",[])})
    return {"people":people,"suggestions":suggestions,"feed":feed,"points":ranks}


def shared_lines(path):
    parts=[]; segment=[]
    for p in path:
        if math.dist(path[0],p)<350:
            if len(segment)>1: parts.append(segment)
            segment=[]
        elif not segment or math.dist(segment[-1],p)>20:
            segment.append(p)
    if len(segment)>1: parts.append(segment)
    return parts


def save_run(db,user,data,legacy=False):
    uid=user["id"]; rid=text_field(data,"id",1,100)
    existing=db.execute("SELECT id,end,body,shared,note,audio IS NOT NULL AS voice FROM activities WHERE user=? AND id=?",(uid,rid)).fetchone()
    if existing:
        return own_activity(existing)
    path=data.get("path")
    if not isinstance(path,list) or not 2<=len(path)<=15000 or any(not isinstance(p,list) or len(p)!=2 or
            any(type(v) not in (int,float) or not math.isfinite(v) or abs(v)>20000 for v in p) for p in path):
        raise RequestError("De routegegevens zijn onvolledig.")
    meters=sum(math.dist(a,b) for a,b in zip(path,path[1:]))
    if not 1<=meters<=50000 or data.get("mode") not in ("run","walk"):
        raise RequestError("Ongeldige activiteit.")
    end=data.get("end") if legacy else now()
    began=data.get("began")
    if type(end) is not int or type(began) is not int or not 0<=began<=end<=now()+10000:
        raise RequestError("De activiteit heeft een ongeldige start- of eindtijd.")
    height=data.get("height")
    body={"mode":data["mode"],"place":text_field(data,"place",1,120),"meters":round(meters,1),"elapsed":end-began,
          "height":height if type(height) is int and 0<=height<=10000 else None,"points":50+math.floor(meters/100+.5)}
    if not legacy and data.get("shareRoute") is True:
        body["lines"]=shared_lines(path)
    note=str(data.get("note",""))[:500] if legacy else ""
    shared=bool(data.get("shared",True)) and not legacy
    db.execute("INSERT INTO activities(user,id,end,body,shared,note) VALUES(?,?,?,?,?,?)",(uid,rid,end,json.dumps(body),shared,note))
    return body|{"id":rid,"end":end,"note":note,"voice":False,"shared":shared}


def save_note(db,uid,data):
    rid=text_field(data,"id",1,100)
    note=data.get("note","")
    if not isinstance(note,str) or len(note)>500:
        raise RequestError("Een terugblik mag tot 500 tekens bevatten.")
    if not db.execute("SELECT 1 FROM activities WHERE user=? AND id=?",(uid,rid)).fetchone():
        raise RequestError("Activiteit niet gevonden.",404)
    db.execute("UPDATE activities SET note=? WHERE user=? AND id=?",(note,uid,rid))
    if data.get("clip"):
        mime=data.get("mime","").split(";")[0]
        if mime not in ("audio/webm","audio/ogg","audio/mp4","audio/wav"):
            raise RequestError("Dit audioformaat wordt niet ondersteund.")
        try:
            raw=base64.b64decode(data["clip"],validate=True)
        except ValueError:
            raise RequestError("De opname is beschadigd.")
        if len(raw)>3_500_000:
            raise RequestError("De opname is te groot.")
        db.execute("UPDATE activities SET audio=?,mime=? WHERE user=? AND id=?",(raw,mime,uid,rid))


def seed_examples(db):
    routes=json.loads((ROOT/"demo_routes.json").read_text())
    bots=db.execute("SELECT id FROM users WHERE kind='bot' ORDER BY id").fetchall()
    end=now()
    for i,bot in enumerate(bots):
        for j in range(2):
            seed_run(db,bot["id"],routes[(i+j)%len(routes)],end-(i*2+j+1)*60000,week_key(end)+"-"+str(j))


def seed_run(db,uid,route,end,rid,note=""):
    path=route["path"]
    meters=sum(math.dist(a,b) for a,b in zip(path,path[1:]))
    body={"mode":"run" if len(path)%2 else "walk","place":"Korenmarkt, Gent","meters":round(meters,1),
          "elapsed":round(meters*(360 if len(path)%2 else 720)),"height":route["height"],"points":50+math.floor(meters/100+.5)}
    body["lines"]=shared_lines(path)
    db.execute("INSERT OR IGNORE INTO activities(user,id,end,body,shared,note) VALUES(?,?,?,?,1,?)",
               (uid,"demo-"+rid,end,json.dumps(body),note))


def demo(db):
    seed_examples(db)
    uid=db.execute("INSERT INTO users(handle,name,kind) VALUES(?,'Demo-speler','guest')",("demo_"+secrets.token_hex(6),)).lastrowid
    bots=[r[0] for r in db.execute("SELECT id FROM users WHERE kind='bot' ORDER BY id")]
    for i,bot in enumerate(bots[:3]):
        db.execute("INSERT INTO friends VALUES(?,?,?,?)",(min(uid,bot),max(uid,bot),bot,int(i<2)))
    end=now()
    routes=json.loads((ROOT/"demo_routes.json").read_text())
    seed_run(db,uid,routes[0],end-30*60000,"recent","De eerste zon op het water aan de kade.")
    seed_run(db,uid,routes[3],end-2*DAY,"earlier","Het was fijn om even buiten te zijn.")
    return uid

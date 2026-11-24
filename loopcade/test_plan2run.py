"""Regression checks for friendships, private activities and account sessions."""
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import database as app


class Plan2RunTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path=Path(temp.name)/"test.sqlite3"
        app.initialize(path)
        self.db=app.connect(path)
        self.addCleanup(self.db.close)
        self.players=[]
        for handle in ("loper","maatje","derde"):
            uid=self.db.execute("INSERT INTO users(name,handle) VALUES(?,?)",(handle,handle)).lastrowid
            self.players.append(self.db.execute("SELECT id,name,handle,kind FROM users WHERE id=?",(uid,)).fetchone())
        self.a,self.b,self.other=self.players
        self.route=json.loads((app.ROOT/"demo_routes.json").read_text())[0]

    def befriend(self):
        app.friend_action(self.db,self.a,self.b["id"],"request")
        app.friend_action(self.db,self.b,self.a["id"],"accept")

    def run_data(self,rid):
        return dict(self.route,id=rid,began=app.now()-3_600_000,mode="run",place="Korenmarkt",shared=True)

    def test_feed_consent_and_ownership(self):
        run=self.run_data("one")
        app.save_run(self.db,self.a,run)
        app.save_note(self.db,self.a["id"],{"id":"one","note":"PrivÃ©"})
        self.assertEqual(app.social(self.db,self.b)["feed"],[])
        self.befriend()
        feed=app.social(self.db,self.b)["feed"]
        self.assertEqual(len(feed),1)
        self.assertFalse(set(feed[0]) & {"note","place","path","audio"})
        self.assertEqual(feed[0]["lines"],[])
        self.db.execute("UPDATE activities SET shared=0 WHERE id='one'")
        self.assertFalse(app.social(self.db,self.b)["feed"])
        with self.assertRaises(app.RequestError):
            app.save_note(self.db,self.b["id"],{"id":"one","note":"Ander"})

    def test_login_credentials_and_session_storage(self):
        data={"naam":"Lotte","gebruikersnaam":"lotte","wachtwoord":"Testwoord-99"}
        uid=app.register(self.db,data)
        self.assertEqual(uid,app.login(self.db,data))
        with self.assertRaises(app.RequestError):
            app.register(self.db,dict(data,gebruikersnaam="LOTTE"))
        with self.assertRaises(app.RequestError):
            app.login(self.db,dict(data,wachtwoord="fout"))
        stored=self.db.execute("SELECT password FROM users WHERE id=?",(uid,)).fetchone()[0]
        self.assertNotEqual(stored,data["wachtwoord"])
        token=app.issue_session(self.db,uid)
        self.assertEqual(self.db.execute("SELECT token FROM sessions").fetchone()[0],app.token_hash(token))

    def test_private_import_and_idempotent_finish(self):
        run=self.run_data("example")
        run.update(end=app.now(),note="Mijn notitie",shareRoute=True)
        result=app.save_run(self.db,self.a,run,legacy=True)
        self.assertFalse(result["shared"])
        self.assertEqual(result,app.save_run(self.db,self.a,run))
        self.assertEqual(len(app.self_state(self.db,self.a)["activities"]),1)
        self.assertFalse(app.self_state(self.db,self.b)["activities"])

    def test_demo_contains_two_friends_and_private_history(self):
        uid=app.demo(self.db)
        guest=self.db.execute("SELECT id,name,handle,kind FROM users WHERE id=?",(uid,)).fetchone()
        data=app.social(self.db,guest)
        self.assertEqual(sum(p["accepted"] for p in data["people"]),2)
        self.assertEqual(len(app.self_state(self.db,guest)["activities"]),2)
        self.assertTrue(any(row["lines"] for row in data["feed"]))
        monday=int(datetime.fromisoformat("2026-03-29T22:00:00+00:00").timestamp()*1000)
        self.assertEqual(app.week_key(monday),"2026-03-30")
        self.assertEqual(app.week_key(monday-1),"2026-03-23")


if __name__=="__main__":unittest.main()

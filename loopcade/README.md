# plan2run lokaal starten

Start vanuit deze map de app met Python 3.10 of hoger.

```powershell
python serve.py --port 8049
```

Open [plan2run](http://127.0.0.1:8049/). Kies **Probeer de demo** voor een eigen demosessie met twee vrienden, een openstaand verzoek, activiteiten en persoonlijke terugblikken. Met **Registreren** maak je een eigen account dat je later opnieuw kunt openen.

De Python-server levert de website en de account-API. Bij de eerste start maakt hij de SQLite-database aan in `data/plan2run.sqlite3`. Een herstart behoudt de gegevens. Alle browsers die dezelfde server gebruiken, delen de vriendenlijst en activiteiten volgens de ingestelde zichtbaarheid.

De regressietests gebruiken een tijdelijke database.

```powershell
python -m unittest -v test_plan2run
```

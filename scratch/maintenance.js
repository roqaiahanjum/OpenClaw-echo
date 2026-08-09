const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./openclaw.db');

db.serialize(() => {
    console.log("[Maintenance] Running integrity check...");
    db.get("PRAGMA integrity_check;", (err, row) => {
        if (err) console.error(err);
        else console.log("Integrity Status:", row.integrity_check);
    });

    console.log("[Maintenance] Optimizing database (VACUUM)...");
    db.run("VACUUM;", (err) => {
        if (err) console.error(err);
        else console.log("Database optimized.");
    });

    console.log("[Maintenance] Checking message count...");
    db.get("SELECT count(*) as count FROM interactions;", (err, row) => {
        if (err) console.error(err);
        else console.log("Total messages in DB:", row.count);
        db.close();
    });
});

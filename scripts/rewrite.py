import sqlite3
conn = sqlite3.connect('backend/en_dict.db')
conn.row_factory = sqlite3.Row
for word in ['countless', 'compute', 'beautiful', 'run', 'freedom']:
    row = conn.execute("SELECT word, etymology FROM en_dictionary WHERE word = ?", (word,)).fetchone()
    if row:
        print(f"{row['word']}: {row['etymology']}")
conn.close()
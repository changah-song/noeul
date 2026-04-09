from fastapi import FastAPI
from konlpy.tag import Okt
from konlpy.tag import Kkma
from fastapi.middleware.cors import CORSMiddleware

"""

Batch Size: Send one chapter at a time (or roughly 1,000–2,000 words).

Trigger: Send the API request for the next chapter in the background while the user is still
reading the current one. This is called Pre-fetching.

Cache Limit: Set a limit (e.g., 5,000 words). When you exceed it, delete the oldest entries.

The API Response: Instead of a list, have Python return a Dictionary/Map (e.g., {"learned": "learn"}).
Looking up a key in a Dictionary in JavaScript is $O(1)$—which means it takes the same amount of time
 whether you have 10 words or 10,000 words cached.


"""

app = FastAPI()
okt = Okt()
kkma = Kkma()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/okt_morphs/")
async def get_okt_morphs(text: str):
    print(f"[main] Received request | text: {text!r}")
    raw_morphs = okt.pos(text, stem=True)
    print(f"[main] Raw morphs ({len(raw_morphs)} total): {raw_morphs}")
    allowed_pos = ['Noun', 'Verb', 'Adverb', 'Adjective']
    filtered_stems = [word for word, pos in raw_morphs if pos in allowed_pos]
    print(f"[main] Filtered stems (first 20): {filtered_stems[:20]}")
    return {"result": filtered_stems}

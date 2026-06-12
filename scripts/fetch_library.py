import time
import json
import re
import requests
from bs4 import BeautifulSoup
from opencc import OpenCC

# Initialize full Traditional to Simplified processing pipeline
cc = OpenCC('t2s')

API_URL = "https://zh.wikisource.org/w/api.php"
headers = {
    'User-Agent': 'ModernMandarinReaderApp/2.0 (dev_contact@yourdomain.com) IngestionPipeline'
}

# Explicit definition of targets mapping the URL endings requested
BOOKS_TO_SCRAPE = [
    {"id": "er_ma", "title": "二馬", "type": "auto"},
    {"id": "chen_lun", "title": "沉淪_(郁達夫)", "type": "auto"},
    {
        "id": "fang_huang",
        "title": "彷徨",
        "type": "collection",
        "chapters": [
            "祝福",
            "弟兄",
            "離婚",
            "幸福的家庭",
            "傷逝 (魯迅)",
            "長明燈",
            "孤獨者",
            "高老夫子",
            "示衆",
            "肥皂",
            "在酒樓上",
        ],
    },
    {
        "id": "ne_han",
        "title": "吶喊",
        "type": "collection",
        "include_root_as": "自序",
        "chapters": [
            "狂人日記",
            "孔乙己",
            "藥",
            "明天",
            "一件小事",
            "頭髮的故事",
            "風波",
            "故鄉",
            "阿Q正傳",
            "端午節",
            "白光",
            "兔和貓",
            "鴨的喜劇",
            "社戲",
        ],
    },
    {"id": "ah_q", "title": "阿Q正傳", "type": "auto"},
    {"id": "kuang_ren", "title": "狂人日記", "type": "auto"},
    {"id": "kong_yi_ji", "title": "孔乙己", "type": "auto"},
    {"id": "luotuo_xiangzi", "title": "駱駝祥子", "type": "auto"}
]

SKIP_SELECTORS = [
    "style",
    "script",
    "table",
    "sup.reference",
    ".mw-editsection",
    ".noprint",
    ".metadata",
    ".licenseContainer",
    ".sisterproject",
    ".ws-noexport",
    ".printfooter",
    "#toc",
    ".toc",
]

BOILERPLATE_PREFIXES = (
    "作者：",
    "本作品",
    "此版本",
    "另參見",
    "另参见",
    "检索自",
    "檢索自",
    "维基文库",
    "維基文庫",
    "Public domain",
)

CHINESE_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "兩": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}

def chinese_number_to_int(value):
    if not value:
        return None
    value = value.strip()
    if value.isdigit():
        return int(value)
    if value == "十":
        return 10
    if "十" in value:
        left, right = value.split("十", 1)
        tens = CHINESE_DIGITS.get(left, 1) if left else 1
        ones = CHINESE_DIGITS.get(right, 0) if right else 0
        return tens * 10 + ones
    total = 0
    for char in value:
        if char not in CHINESE_DIGITS:
            return None
        total = total * 10 + CHINESE_DIGITS[char]
    return total

def chapter_sort_key(title):
    display_title = title.rsplit("/", 1)[-1]
    if display_title in ("序", "自序"):
        return (0, 0, display_title)
    if display_title.isdigit():
        return (1, int(display_title), display_title)

    match = re.search(r"(?:第)?([零〇一二兩两三四五六七八九十]+)(?:[章节回段])?", display_title)
    if match:
        number = chinese_number_to_int(match.group(1))
        if number is not None:
            return (1, number, display_title)

    return (2, display_title)

def clean_extracted_text(text):
    """Normalizes whitespace and standardizes character variants."""
    if not text:
        return ""
    # Convert Traditional characters to Simplified
    simplified = cc.convert(text)
    
    # Strip any common systemic Wiki boilerplates if caught by text extracts
    lines = [line.strip() for line in simplified.split('\n')]
    clean_lines = [
        l for l in lines
        if l
        and not l.startswith('==')
        and not l.startswith('导航')
        and not any(l.startswith(prefix) for prefix in BOILERPLATE_PREFIXES)
    ]
    
    return "\n\n".join(clean_lines)

def text_from_parse_html(html):
    soup = BeautifulSoup(html or "", "html.parser")
    root = soup.select_one(".mw-parser-output") or soup

    for selector in SKIP_SELECTORS:
        for node in root.select(selector):
            node.decompose()

    blocks = []
    for node in root.find_all(["h2", "h3", "h4", "p"], recursive=True):
        text = node.get_text("\n", strip=True)
        if not text:
            continue
        if text in ("目录", "目錄"):
            continue
        blocks.append(text)

    return "\n\n".join(blocks)

def fetch_parse_text(page_title):
    """Fallback for Wikisource pages where TextExtracts returns an empty body."""
    params = {
        "action": "parse",
        "page": page_title,
        "prop": "text",
        "disableeditsection": True,
        "redirects": True,
        "format": "json"
    }
    try:
        res = requests.get(API_URL, params=params, headers=headers).json()
        html = res.get("parse", {}).get("text", {}).get("*", "")
        return text_from_parse_html(html)
    except Exception as e:
        print(f"Error parsing HTML fallback for {page_title}: {e}")
    return ""

def fetch_root_text(page_title):
    """Pulls text directly if the page is a single, self-contained short story."""
    params = {
        "action": "query",
        "titles": page_title,
        "prop": "extracts",
        "explaintext": True,
        "format": "json"
    }
    try:
        res = requests.get(API_URL, params=params, headers=headers).json()
        pages = res.get("query", {}).get("pages", {})
        for _, val in pages.items():
            if "extract" in val:
                extract = val["extract"]
                if clean_extracted_text(extract):
                    return extract
    except Exception as e:
        print(f"Error fetching root text for {page_title}: {e}")

    return fetch_parse_text(page_title)

def discover_subpages(page_title):
    """Queries MediaWiki to find sub-chapters belonging to the parent workspace namespace."""
    params = {
        "action": "query",
        "list": "allpages",
        "apprefix": f"{page_title}/",
        "apnamespace": 0, # Main content namespace
        "aplimit": 100,
        "format": "json"
    }
    try:
        res = requests.get(API_URL, params=params, headers=headers).json()
        pages = res.get("query", {}).get("allpages", [])
        # Return naturally sorted list of subpage strings. Plain lexicographic
        # sorting puts chapter 10 before chapter 2 and 第三段 before 第二段.
        return sorted([p["title"] for p in pages], key=chapter_sort_key)
    except Exception as e:
        print(f"Subpage discovery failed for {page_title}: {e}")
    return []

def append_chapter(chapters_payload, order_idx, display_title, raw_text):
    processed_content = clean_extracted_text(raw_text)

    if processed_content:
        chapters_payload.append({
            "chapter_index": order_idx + 1,
            "chapter_title": cc.convert(display_title),
            "content": processed_content
        })
        print(f"       ✓ captured {len(processed_content):,} chars")
        return True

    print("       ! no extractable text; skipped")
    return False

def process_book(book_metadata):
    book_title = book_metadata["title"]
    print(f"\nProcessing target: 《{book_title}》...")
    
    chapters_payload = []

    if book_metadata.get("type") == "collection":
        explicit_chapters = book_metadata.get("chapters", [])
        print(f" -> Using explicit collection map. Found {len(explicit_chapters)} linked works.")

        if book_metadata.get("include_root_as"):
            print(f"    Fetching root node: {book_metadata['include_root_as']}")
            append_chapter(chapters_payload, 0, book_metadata["include_root_as"], fetch_root_text(book_title))
            time.sleep(0.3)

        offset = len(chapters_payload)
        for order_idx, chapter_title in enumerate(explicit_chapters):
            print(f"    Fetching linked work node: {chapter_title}")
            append_chapter(chapters_payload, offset + order_idx, chapter_title, fetch_root_text(chapter_title))
            time.sleep(0.3)

        return {
            "book_id": book_metadata["id"],
            "book_title": cc.convert(book_title),
            "chapters": chapters_payload
        }

    # Step 1: Detect if this resource contains structural subpages
    subpages = discover_subpages(book_title)

    if subpages:
        print(f" -> Detected chapter array. Found {len(subpages)} sub-items.")
        for order_idx, subpage in enumerate(subpages):
            # Isolate chapter sub-label (e.g., "第一章") from the absolute path string
            display_title = subpage.replace(f"{book_title}/", "")
            print(f"    Fetching subpage node: {display_title}")
            
            raw_text = fetch_root_text(subpage)
            append_chapter(chapters_payload, order_idx, display_title, raw_text)
            time.sleep(0.3) # Avoid hitting API limits
    else:
        # Step 2: Fallback parsing option for self-contained single works
        print(" -> Detected standalone format. Executing direct extraction...")
        raw_text = fetch_root_text(book_title)
        append_chapter(chapters_payload, 0, book_title, raw_text)
            
    return {
        "book_id": book_metadata["id"],
        "book_title": cc.convert(book_title),
        "chapters": chapters_payload
    }

def main():
    compiled_library = []
    
    for book_meta in BOOKS_TO_SCRAPE:
        result = process_book(book_meta)
        if result["chapters"]:
            compiled_library.append(result)
        else:
            print(f" -> WARNING: 《{book_meta['title']}》 produced no chapters and was not exported.")
        time.sleep(0.5)
        
    # Write full output straight into your codebase data directory
    output_path = "library_export.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(compiled_library, f, ensure_ascii=False, indent=2)
        
    print(f"\n🚀 Complete! System pipeline synced. Output compiled in -> {output_path}")

if __name__ == "__main__":
    main()

import json

results = json.load(open('scripts/.hanja_characters_results_<new_batch_id>.json'))
data = json.load(open('scripts/hanja_translated_multilingual.json'))

for entry in data:
    character = entry['character']
    eum = entry['eum']
    char_cp = ord(character)
    eum_cp = ord(eum) if len(eum) == 1 else sum(ord(c) for c in eum)
    request_id = f"char_{char_cp}_{eum_cp}_zh"
    if request_id in results:
        entry['hun_zh'] = results[request_id]

json.dump(data, open('scripts/hanja_translated_multilingual.json', 'w'), ensure_ascii=False, indent=2)
print("Done")
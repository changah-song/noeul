"""Writes the store images' HTML: python3 make.py && sh render.sh

shots/ holds simulator screenshots (1320x2868): home.png, reader.png, song.png.
"""
import sys
from pathlib import Path
HERE = Path(__file__).parent
SONG_SHOT = 'song.png'
# The song shot's video area (top, bottom as fractions of the screen height) is
# covered by a drawn waveform, so no performer or label artwork shows.
BLUR_ARG = (0.137, 0.398)

COPY = {
  'en': dict(
    banner_dim='Read real books.', banner_main='Learn the language.',
    banner_sub='Korean, Chinese and English. Books, and now songs: one tap at a time.',
    new='NEW · SONGS',
    songs_dim='Learn from songs.', songs_main='Every line, translated.',
    songs_sub='The music video plays, the line being sung lights up, and its translation sits right under it.',
  ),
  'ko': dict(
    banner_dim='진짜 책을 읽으며', banner_main='외국어를 배우세요.',
    banner_sub='영어 · 한국어 · 중국어. 책도, 이제 노래도 탭 한 번으로.',
    new='NEW · 노래',
    songs_dim='노래로 배우기.', songs_main='줄마다 번역과 함께.',
    songs_sub='뮤직비디오에 맞춰 부르는 줄이 밝아지고, 바로 아래에 번역이 나와요.',
  ),
}

# Fraction of the screenshot's height covered by the video, drawn over with a
# waveform (None = leave the screenshot as is).
BLUR = BLUR_ARG

import math, random
_rng = random.Random(4)
WAVE_BARS = ''.join(f'<i style="height:{round(18 + 70 * abs(math.sin(i * 0.45)) * _rng.uniform(0.5, 1))}%"></i>'
                    for i in range(34))

def phone(shot, x, y, pw, rot=0, z=1):
    blur = ''
    if BLUR and shot == SONG_SHOT:
        top, bottom = BLUR
        blur = (f'<div class="wave" style="top:{top*100:.2f}%;height:{(bottom-top)*100:.2f}%">'
                f'<div class="bars">{WAVE_BARS}</div><div class="prog"><b></b><u></u></div></div>')
    return (f'<div class="phone" style="--pw:{pw}px;left:{x}px;top:{y}px;transform:rotate({rot}deg);z-index:{z}">'
            f'<div class="screen"><img src="shots/{shot}">{blur}</div><div class="island"></div></div>')

def page(w, h, body):
    return (f'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="base.css">'
            f'<style>:root{{--w:{w}px;--h:{h}px}}</style></head><body>{body}</body></html>')

def banner(c, w, h, s=1.0):
    # Landscape: copy on the left, three phones fanned on the right.
    S = lambda v: round(v * s)
    pw = S(470)
    body = (f'<div class="orb" style="width:{S(1500)}px;height:{S(1500)}px;right:{S(-420)}px;top:{S(-700)}px"></div>'
            f'<div style="position:absolute;left:{S(150)}px;top:{S(330)}px;width:{S(1150)}px">'
            f'<div class="new" style="font-size:{S(30)}px;padding:{S(12)}px {S(26)}px;margin-bottom:{S(44)}px">{c["new"]}</div>'
            f'<div class="title" style="font-size:{S(118)}px"><span class="dim">{c["banner_dim"]}</span>{c["banner_main"]}</div>'
            f'<div class="sub" style="font-size:{S(42)}px;margin-top:{S(40)}px;max-width:{S(1000)}px">{c["banner_sub"]}</div></div>'
            + phone('home.png', S(1330), S(260), S(450), -6, 1)
            + phone(SONG_SHOT, S(1800), S(120), S(500), 0, 3)
            + phone('reader.png', S(2290), S(260), S(450), 6, 2))
    return page(w, h, body)

def header(c, w=3840, h=1646):
    # App Store product page header (21:9). The store crops the sides on
    # narrower screens, so the copy sits in the middle with phones either side.
    pw = 500
    body = (f'<div class="orb" style="width:1700px;height:1700px;right:-300px;top:-900px"></div>'
            f'<div style="position:absolute;left:{(w - 1300) // 2}px;top:520px;width:1300px;text-align:center;z-index:5">'
            f'<div class="new" style="font-size:34px;padding:14px 30px;margin-bottom:46px">{c["new"]}</div>'
            f'<div class="title" style="font-size:118px"><span class="dim">{c["banner_dim"]}</span>{c["banner_main"]}</div>'
            f'<div class="sub" style="font-size:44px;margin:40px auto 0;max-width:1100px">{c["banner_sub"]}</div></div>'
            + phone('home.png', 330, 360, pw, -6, 1)
            + phone('reader.png', 730, 250, pw, 4, 2)
            + phone(SONG_SHOT, 2760, 230, 540, 0, 3))
    return page(w, h, body)

def songs(c, w, h, s=1.0):
    S = lambda v: round(v * s)
    pw = S(1000)
    body = (f'<div class="orb" style="width:{S(1400)}px;height:{S(1400)}px;right:{S(-700)}px;top:{S(-300)}px"></div>'
            f'<div style="position:absolute;left:0;right:0;top:{S(170)}px;text-align:center;padding:0 {S(90)}px">'
            f'<div class="new" style="font-size:{S(34)}px;padding:{S(12)}px {S(30)}px;margin-bottom:{S(44)}px">{c["new"]}</div>'
            f'<div class="title" style="font-size:{S(112)}px"><span class="dim">{c["songs_dim"]}</span>{c["songs_main"]}</div>'
            f'<div class="sub" style="font-size:{S(44)}px;margin:{S(40)}px auto 0;max-width:{S(1060)}px">{c["songs_sub"]}</div></div>'
            + phone(SONG_SHOT, (w - pw) // 2, S(820), pw, 0, 1))
    return page(w, h, body)

def feature(c):
    # Play feature graphic 1024x500. Play's desktop site crops the sides, so
    # everything stays inside the middle ~800px (x 110-914).
    body = ('<div class="orb" style="width:620px;height:620px;right:-150px;top:-300px"></div>'
            '<div style="position:absolute;left:120px;top:110px;width:440px">'
            f'<div class="new" style="font-size:13px;padding:6px 13px;margin-bottom:18px">{c["new"]}</div>'
            f'<div class="title" style="font-size:40px"><span class="dim">{c["banner_dim"]}</span>{c["banner_main"]}</div>'
            f'<div class="sub" style="font-size:16px;margin-top:16px;max-width:380px">{c["banner_sub"]}</div></div>'
            + phone('reader.png', 720, 120, 180, 6, 1) + phone(SONG_SHOT, 580, 60, 200, -4, 2))
    return page(1024, 500, body)

out = []
for lang, c in COPY.items():
    for name, html in [
        (f'appstore-00-banner-{lang}-2868x1320', banner(c, 2868, 1320)),
        (f'appstore-07-songs-{lang}-1320x2868', songs(c, 1320, 2868)),
        (f'appstore-header-{lang}-3840x1646', header(c)),
        (f'play-07-songs-{lang}-1080x1920', songs(c, 1080, 1920 + 0, 1080 / 1320)),
        (f'play-feature-graphic-{lang}-1024x500', feature(c)),
    ]:
        (HERE / f'{name}.html').write_text(html)
        out.append(name)
print('\n'.join(out))

"""Render the 30-second REFLUENZ motion study. Pillow + NumPy, then encode with FFmpeg.
Usage: python scripts/render-film.py [--preview]
All imagery is the project's generated editorial artwork. Type/layout/motion are authored here.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import math, sys, wave
import numpy as np

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'video-frames'; OUT.mkdir(exist_ok=True)
W,H,FPS=1920,1080,24
PAPER=(251,249,249); INK=(27,28,28); MUTED=(101,100,96); RULE=(210,208,205); BRONZE=(113,91,51); SAND=(223,195,146)
FONT='/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf'
BOLD='/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf'
if not Path(FONT).exists():
 FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'; BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
fonts={}
def font(size,bold=False):
 key=(int(size),bold)
 if key not in fonts: fonts[key]=ImageFont.truetype(BOLD if bold else FONT,int(size))
 return fonts[key]
photos={k:ImageOps.grayscale(Image.open(ROOT/'public/editorial'/f'{k}.png')).convert('RGB') for k in ['atelier','ritual','architecture']}
def clamp(x):return max(0,min(1,x))
def ease(x):x=clamp(x);return 1-(1-x)**3

def text(im,xy,s,size=24,color=INK,bold=False,tracking=0):
 d=ImageDraw.Draw(im); x,y=xy; f=font(size,bold)
 if not tracking:d.text((x,y),s,font=f,fill=color,anchor='lt');return d.textlength(s,font=f)
 for c in s:
  d.text((x,y),c,font=f,fill=color,anchor='lt');x+=d.textlength(c,font=f)+tracking
 return x-xy[0]
def line(im,xy,fill=RULE,width=1):ImageDraw.Draw(im).line(xy,fill=fill,width=width)
def reveal(im,x,y,s,size,p,color=INK,bold=False):
 p=ease(p);layer=Image.new('RGBA',(W,H),(0,0,0,0));text(layer,(x,y+(1-p)*70),s,size,(*color,int(255*p)),bold);im.paste(layer,(0,0),layer)
def photo(im,key,box,t=0,zoom=1.04):
 x,y,w,h=map(int,box);src=photos[key];scale=max(w/src.width,h/src.height)*(zoom+.025*math.sin(t*.4));nw,nh=int(src.width*scale),int(src.height*scale);scaled=src.resize((nw,nh),Image.Resampling.LANCZOS);ox=(nw-w)//2;oy=int((nh-h)*(.45+.025*math.sin(t*.25)));im.paste(scaled.crop((ox,oy,ox+w,oy+h)),(x,y))
def label(im,x,y,s,color=BRONZE):text(im,(x,y),s,17,color,True,3)
def arrow(im,x,y,size=35,color=INK):line(im,(x,y,x+size,y),color,2);line(im,(x+size-10,y-10,x+size,y,x+size-10,y+10),color,2)
def footer(im,t,dark=False):
 c=SAND if dark else BRONZE;line(im,(80,1016,1840,1016),(70,70,68) if dark else RULE)
 text(im,(80,1034),'REFLUENZ / THE DIGITAL ATELIER',13,(185,183,179) if dark else MUTED,False,2)
 text(im,(1690,1034),f'00:{int(t):02d} / 00:30',13,(185,183,179) if dark else MUTED)
 line(im,(80,1016,80+1760*t/30,1016),c,3)

def scene0(t):
 im=Image.new('RGB',(W,H),PAPER)
 label(im,80,72,'INDEPENDENT BY DESIGN')
 text(im,(1685,72),'EDITION 001',15,MUTED,False,2)
 p=ease(t/1.5);size=220
 # Letter spacing contracts into the final wordmark.
 tracking=24*(1-p)-5
 total=sum(ImageDraw.Draw(im).textlength(c,font=font(size,True))+tracking for c in 'REFLUENZ')
 text(im,((W-total)/2,350+30*(1-p)),'REFLUENZ',size,INK,True,tracking)
 line(im,(110,603,110+1700*ease((t-.3)/1.8),603),BRONZE,2)
 reveal(im,116,651,'THE DIGITAL ATELIER',28,(t-1)/1.2,MUTED)
 reveal(im,116,768,'A considered space for independent voices.',37,(t-1.7)/1.2,INK)
 footer(im,t)
 return im

def scene1(t):
 im=Image.new('RGB',(W,H),INK)
 label(im,80,72,'01 — A DIFFERENT KIND OF CONNECTION',SAND)
 reveal(im,130,248,'LESS NOISE.',148,t/.9,PAPER,True)
 reveal(im,130,445,'MORE MEANING.',148,(t-.55)/.9,PAPER,True)
 line(im,(140,680,140+1100*ease((t-.7)/1.4),680),SAND,2)
 reveal(im,140,760,'No ads. No algorithm in between.',34,(t-1.1)/.9,(190,188,184))
 footer(im,t+4,True)
 return im

def scene2(t):
 im=Image.new('RGB',(W,H),PAPER)
 photo(im,'atelier',(0,0,865,1000),t,1.03)
 d=ImageDraw.Draw(im);d.rectangle((28,28,837,970),outline=(200,198,193),width=1)
 label(im,940,100,'02 — A HOME FOR YOUR POINT OF VIEW')
 reveal(im,938,270,'OWN YOUR',108,t/.95,INK,True)
 reveal(im,938,402,'AESTHETIC.',108,(t-.25)/.95,INK,True)
 reveal(im,942,595,'The work. The process.',35,(t-.9)/.8,MUTED)
 reveal(im,942,655,'The people behind it.',35,(t-1.15)/.8,MUTED)
 line(im,(945,794,1750,794),RULE)
 label(im,945,827,'STYLE / BEAUTY / DESIGN / CULTURE',BRONZE)
 footer(im,t+8)
 return im

def interface(t):
 im=Image.new('RGB',(W,H),PAPER)
 label(im,80,62,'03 — THE EXPERIENCE')
 reveal(im,80,116,'WORK WORTH RETURNING TO.',61,t/.8,INK,True)
 # A deliberately simplified animated interface study, matching the actual app's geometry.
 x,y=80,250;w,h=1760,710;d=ImageDraw.Draw(im)
 d.rectangle((x,y,x+w,y+h),fill=(255,255,255),outline=RULE,width=2)
 d.rectangle((x,y,x+255,y+h),fill=PAPER,outline=RULE)
 text(im,(x+27,y+35),'REFLUENZ',30,INK,True,-1)
 label(im,x+27,y+92,'YOUR PRIVATE SPACE',MUTED)
 for i,s in enumerate(['The atelier','Discover','Private archive','Your circle']):
  yy=y+165+i*70
  if i==0:d.rectangle((x+15,yy-15,x+236,yy+35),fill=(234,231,226));line(im,(x+15,yy-15,x+15,yy+35),BRONZE,3)
  text(im,(x+45,yy),s,19,INK if i==0 else MUTED)
 text(im,(x+27,y+h-72),'Independent by design.',15,MUTED)
 main=x+300
 label(im,main,y+37,'SELECTED FOR A SLOWER SCROLL')
 text(im,(main,y+83),'Your daily edit.',56,INK,False,-2)
 fx,fy=main,y+170
 photo(im,'atelier',(fx,fy,405,445),t,1.05)
 d.rectangle((fx+405,fy,fx+915,fy+445),fill=PAPER,outline=RULE)
 label(im,fx+443,fy+35,'ELENA VOSS / STYLE & CULTURE')
 reveal(im,fx+443,fy+123,'The pieces',53,(t-.5)/.9,INK)
 reveal(im,fx+443,fy+185,'you return to.',53,(t-.65)/.9,INK)
 text(im,(fx+443,fy+280),'On finding a personal uniform,',21,MUTED)
 text(im,(fx+443,fy+315),'and the freedom of choosing well.',21,MUTED)
 text(im,(fx+443,fy+390),'READ THE ENTRY',14,INK,True,2);arrow(im,fx+660,fy+399,28)
 rx=x+w-480
 label(im,rx+5,y+170,'YOUR CIRCLE',MUTED)
 for i,s in enumerate(['Elena Voss','Sera Lin','Julian Dax']):
  yy=y+215+i*64;d.rectangle((rx+5,yy,rx+42,yy+42),fill=(230,226,223));text(im,(rx+14,yy+12),''.join(z[0] for z in s.split()),14,INK);text(im,(rx+58,yy+12),s,20,INK)
 d.rectangle((rx,y+451,rx+385,y+615),fill=(239,237,233))
 text(im,(rx+24,y+477),'A LITTLE LESS.',24,INK)
 text(im,(rx+24,y+513),'A LITTLE BETTER.',24,INK)
 label(im,rx+24,y+570,'YOUR OWN PRIVATE ARCHIVE',BRONZE)
 # Save state appears as an understated product moment.
 saved=t>2.5
 bx,by=fx+861,fy+385
 pts=[(bx,by),(bx+19,by),(bx+19,by+27),(bx+9,by+20),(bx,by+27)]
 d.polygon(pts,fill=BRONZE if saved else PAPER,outline=BRONZE)
 if saved:
  d.rectangle((main+585,y+h-51,main+910,y+h-12),fill=INK)
  text(im,(main+607,y+h-40),'SAVED TO YOUR PRIVATE ARCHIVE',12,PAPER,True,1)
 footer(im,t+13)
 return im

def scene4(t):
 im=Image.new('RGB',(W,H),INK)
 label(im,80,62,'04 — CLOSER TO THE WORK. CLOSER TO EACH OTHER.',SAND)
 for i,(key,verb,note) in enumerate([('atelier','READ.','A point of view.'),('ritual','COLLECT.','An idea to return to.'),('architecture','CONNECT.','A circle of your own.')]):
  x=80+i*590;p=ease((t-i*.2)/1.1);yy=int(170+(1-p)*70)
  photo(im,key,(x,yy,550,550),t+i,1.04)
  reveal(im,x,758,verb,65,(t-.5-i*.18)/.85,PAPER,True)
  reveal(im,x,860,note,25,(t-1-i*.18)/.8,(190,188,184))
 footer(im,t+19,True)
 return im

def scene5(t):
 im=Image.new('RGB',(W,H),PAPER)
 label(im,80,72,'AN OPEN INVITATION')
 reveal(im,100,240,'YOUR PEOPLE.',127,t/.85,INK,True)
 reveal(im,100,390,'YOUR PLACE.',127,(t-.25)/.85,INK,True)
 line(im,(105,577,105+1670*ease((t-.5)/1.4),577),BRONZE,2)
 reveal(im,108,632,'REFLUENZ',80,(t-.85)/.9,INK,True)
 reveal(im,110,743,'The digital atelier. Independent by design.',30,(t-1.3)/.9,MUTED)
 if t>1.6:
  d=ImageDraw.Draw(im);x=1175;y=690;d.rectangle((x,y,1775,y+110),fill=INK)
  text(im,(x+40,y+43),'STEP INSIDE THE DEMO',24,PAPER,True,2);arrow(im,1690,y+55,36,PAPER)
 reveal(im,110,888,'No sign-up. No payment. Just the experience.',21,(t-2)/.8,MUTED)
 footer(im,t+24)
 return im
scenes=[(0,4,scene0),(4,8,scene1),(8,13,scene2),(13,19,interface),(19,24,scene4),(24,30,scene5)]
def frame(t):
 for i,(start,end,fn) in enumerate(scenes):
  if t<end or i==len(scenes)-1:
   im=fn(t-start)
   if i>0 and t-start<.35:
    prev=scenes[i-1];im=Image.blend(prev[2](prev[1]-prev[0]-.01),im,ease((t-start)/.35))
   return im

def soundtrack():
 rate=48000;tt=np.arange(rate*30)/rate;audio=np.zeros_like(tt)
 # Original, restrained ambient score: slow sine-pad chords and soft transition tones.
 for start,end,freqs in [(0,8,[146.832,220,293.665]),(8,19,[130.813,196,261.626]),(19,24,[174.614,261.626,349.228]),(24,30,[146.832,220,293.665])]:
  local=tt-start;env=np.clip(local/1.6,0,1)*np.clip((end-tt)/1.8,0,1);env*=((tt>=start)&(tt<end))
  for j,f in enumerate(freqs):audio+=.045*env*np.sin(2*np.pi*f*tt+.09*np.sin(2*np.pi*.13*tt+j))
 for start in [0,4,8,13,19,24]:
  local=np.maximum(tt-start,0);env=np.exp(-local*3)*np.clip(local/.02,0,1)*(tt>=start)
  audio+=.025*env*np.sin(2*np.pi*587.33*local)
 audio*=np.minimum(tt/1.2,1)*np.minimum((30-tt)/1.7,1)
 stereo=np.column_stack([audio,audio*.97]);pcm=(np.clip(stereo,-1,1)*32767).astype('<i2')
 with wave.open(str(OUT/'score.wav'),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(rate);f.writeframes(pcm.tobytes())
if '--preview' in sys.argv:
 for i,t in enumerate([2.5,6,10.5,16.5,21.5,27.5]):frame(t).save(OUT/f'preview-{i}.jpg',quality=94)
else:
 soundtrack()
 for n in range(FPS*30):
  frame(n/FPS).save(OUT/f'frame-{n:04d}.jpg',quality=90,subsampling=0)
  if n%120==0:print(f'{n}/{FPS*30} frames',flush=True)
 frame(27.5).save(ROOT/'public/film/poster.jpg',quality=94)
 print('Frames and original score ready.',flush=True)

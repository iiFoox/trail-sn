const sharp=require('sharp'),fs=require('fs'),crypto=require('crypto');const d='/home/claude/trail-site/b3/img/';const S='/tmp/claude-0/-home-claude/1355b350-d507-52b2-99e3-d63903bae67d/scratchpad/';
const F='/home/claude/trail/docs/screenshots/';
(async()=>{
const out={};
const save=async(n,pipe)=>{const buf=await pipe.png({palette:true,quality:85,compressionLevel:9}).toBuffer();fs.writeFileSync(d+n+'.png',buf);fs.writeFileSync(S+n+'.b64',buf.toString('base64'));out[n]=[buf.length,crypto.createHash('sha1').update(buf).digest('hex')]};
const dark=F+'sidepanel-dark.png', light=F+'sidepanel-light.png'; const m=await sharp(dark).metadata(); const Sx=m.width/536;
const crop=(x,y,w,h)=>({left:Math.round(x*Sx),top:Math.round(y*Sx),width:Math.round(w*Sx),height:Math.round(h*Sx)});
await save('panel-top',sharp(dark).extract(crop(0,0,536,410)));
await save('panel-verdict',sharp(dark).extract(crop(0,600,536,480)));
await save('panel-full',sharp(dark).extract({left:0,top:0,width:m.width,height:Math.round(1900*Sx)}));
await save('sidepanel-light',sharp(light).extract({left:0,top:0,width:m.width,height:Math.round(1900*Sx)}));
await save('popup-dark',sharp(F+'popup-dark.png')); await save('options-dark',sharp(F+'options-dark.png')); await save('options-light',sharp(F+'options-light.png'));
console.log(JSON.stringify(out)); })();

/** Single source of truth for colours; tokens.css must mirror these exactly (tested). */
export const TOKENS:Record<'dark'|'contrast',Record<string,string>>={
  dark:{bg:'#0B0D10',text:'#F2F4F6','text-2':'#9AA3AD',line:'rgba(255,255,255,.08)',danger:'#FF5A52',warn:'#FFB020',ok:'#3DDC97',info:'#6CB6FF',exercise:'#B49CFF',focus:'#FFD84D'},
  contrast:{bg:'#FFFFFF',text:'#0B0D10','text-2':'#3D4651',line:'rgba(0,0,0,.14)',danger:'#C4120A',warn:'#8A5A00',ok:'#0B7A4B',info:'#0A58B0',exercise:'#5B3DC4',focus:'#0B57D0'},
};

function luminance(hex:string){
  const n=hex.replace('#','');const c=[0,2,4].map(i=>parseInt(n.slice(i,i+2),16)/255)
    .map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
}
export function contrastRatio(a:string,b:string){
  const [x,y]=[luminance(a),luminance(b)].sort((p,q)=>q-p);
  return (x+0.05)/(y+0.05);
}

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type SchedulePdfData = {
  league:string; season:string; category:string; group:string; timezone:string; version:number; generatedAt:Date;
  matches:{round:number;home:string;away:string;venue:string;start:string}[];
  byes:{round:number;team:string}[];
};

/** Una instantánea de la propuesta aprobada; no publica ni reserva partidos. */
export async function createSchedulePdf(data:SchedulePdfData):Promise<Uint8Array> {
  const pdf=await PDFDocument.create();
  pdf.setTitle("Programación de jornadas"); pdf.setSubject("Propuesta aprobada");
  const regular=await pdf.embedFont(StandardFonts.Helvetica), bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const color=rgb(0.10,0.20,0.24), muted=rgb(0.32,0.39,0.41), accent=rgb(0.75,0.36,0.22);
  const width=595.28, height=841.89, left=44, right=width-44;
  let page!:PDFPage;
  let y=0, pages=0;
  const safe=(value:string)=>Array.from(value.replace(/[\r\n\t]+/g," ")).map(char=>{
    try { regular.encodeText(char); return char; } catch { return "?"; }
  }).join("");
  function line(text:string,font:PDFFont,size:number,x:number,top:number,colorValue=color) {
    page.drawText(safe(text),{x,y:top-size,size,font,color:colorValue});
  }
  function wrap(text:string,font:PDFFont,size:number,max:number) {
    const words=safe(text).split(/\s+/), lines:string[]=[]; let current="";
    for (let word of words) {
      while(word && font.widthOfTextAtSize(word,size)>max) {
        if(current){lines.push(current);current="";}
        let n=1; while(n<word.length && font.widthOfTextAtSize(word.slice(0,n+1),size)<=max)n++;
        lines.push(word.slice(0,n));word=word.slice(n);
      }
      const candidate=current ? current+" "+word : word;
      if(current && font.widthOfTextAtSize(candidate,size)>max){lines.push(current);current=word;} else current=candidate;
    }
    if(current)lines.push(current);return lines.length?lines:[""];
  }
  function newPage() {
    page=pdf.addPage([width,height]); pages++;
    page.drawRectangle({x:0,y:height-73,width,height:73,color});
    line("PROGRAMACIÓN DE JORNADAS",bold,16,left,height-24,rgb(1,1,1));
    line(wrap("Programación aprobada · " + data.league,regular,9,right-left)[0],regular,9,left,height-48,rgb(0.88,0.92,0.92));
    y=height-93;
  }
  function ensure(space:number) {if(y-space<48)newPage();}
  function text(textValue:string,font:PDFFont,size:number,indent=0,colorValue=color) {
    for(const part of wrap(textValue,font,size,right-left-indent)){ensure(size+5);line(part,font,size,left+indent,y,colorValue);y-=size+5;}
  }
  const format=new Intl.DateTimeFormat("es-MX",{dateStyle:"long",timeStyle:"short",timeZone:data.timezone});
  newPage();
  text(`${data.season} · ${data.category} · Grupo ${data.group}`,bold,12);
  text(`Versión ${data.version} · Generado: ${format.format(data.generatedAt)} · ${data.timezone}`,regular,9,0,muted);
  text("La información corresponde a la propuesta aprobada en el momento de la descarga.",regular,9,0,muted);
  y-=8;
  const rounds=[...new Set([...data.matches.map(m=>m.round),...data.byes.map(b=>b.round)])].sort((a,b)=>a-b);
  for(const round of rounds) {
    ensure(58); page.drawRectangle({x:left,y:y-22,width:right-left,height:22,color:rgb(0.93,0.95,0.95)});
    line(`JORNADA ${round}`,bold,10,left+8,y-5,accent);y-=32;
    const matches=data.matches.filter(m=>m.round===round).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||a.home.localeCompare(b.home));
    for(const match of matches) {
      const title=`${match.home}  vs.  ${match.away}`;
      const detail=`${format.format(new Date(match.start))} · ${match.venue}`;
      const required=(wrap(title,bold,10,right-left-16).length+wrap(detail,regular,9,right-left-16).length)*15+8;
      ensure(required); text(title,bold,10,8);text(detail,regular,9,8,muted);y-=5;
    }
    for(const bye of data.byes.filter(b=>b.round===round)){ensure(22);text(`Descansa: ${bye.team}`,regular,9,8,muted);}
    y-=8;
  }
  for(let index=0;index<pdf.getPageCount();index++) {
    const target=pdf.getPages()[index];target.drawText(`Página ${index+1} de ${pages}`,{x:left,y:25,size:8,font:regular,color:muted});
  }
  return pdf.save();
}

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type SchedulePdfData = {
  league:string; season:string; category:string; group:string; timezone:string; version:number; generatedAt:Date;
  variant?:"original"|"updated";
  matches:{round:number;home:string;away:string;venue:string;start:string|null;status?:string}[];
  byes:{round:number;team:string}[];
};

/** Una instantánea de la propuesta aprobada; no publica ni reserva partidos. */
export async function createSchedulePdf(data:SchedulePdfData):Promise<Uint8Array> {
  const pdf=await PDFDocument.create();
  pdf.setTitle("Programación de jornadas");
  pdf.setSubject(data.variant === "updated" ? "Programación actualizada" : "Propuesta aprobada");
  const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const width=595.28,height=841.89,left=38,right=width-38,usable=right-left;
  const ink=rgb(0.08,0.12,0.14),muted=rgb(0.32,0.36,0.38),shade=rgb(0.94,0.95,0.95);
  const columns=[146,146,127,100];
  let page!:PDFPage,y=0;
  const safe=(s:string)=>Array.from(s.replace(/[\r\n\t]+/g," ")).map(c=>{try{regular.encodeText(c);return c;}catch{return "?";}}).join("");
  function wrap(value:string,font:PDFFont,size:number,max:number) {
    const lines:string[]=[];let current="";
    for(let word of safe(value).split(/\s+/)) {
      while(word && font.widthOfTextAtSize(word,size)>max) {
        if(current){lines.push(current);current="";}
        let n=1;while(n<word.length&&font.widthOfTextAtSize(word.slice(0,n+1),size)<=max)n++;
        lines.push(word.slice(0,n));word=word.slice(n);
      }
      const candidate=current?`${current} ${word}`:word;
      if(current&&font.widthOfTextAtSize(candidate,size)>max){lines.push(current);current=word;} else current=candidate;
    }
    if(current)lines.push(current);return lines.length?lines:[""];
  }
  function center(value:string,font:PDFFont,size:number,top:number) {
    for(const part of wrap(value,font,size,usable)) {
      page.drawText(part,{x:(width-font.widthOfTextAtSize(part,size))/2,y:top-size,font,size,color:ink});top-=size+4;
    }
    return top;
  }
  const dateTime=new Intl.DateTimeFormat("es-MX",{dateStyle:"short",timeStyle:"short",timeZone:data.timezone});
  function newPage() {
    page=pdf.addPage([width,height]);y=height-34;
    y=center("PROGRAMACIÓN DE JORNADAS",bold,15,y)-3;
    y=center(`${data.league} · ${data.season}`,bold,10,y);
    y=center(`${data.category} · Grupo ${data.group}`,regular,9,y)-2;
    y=center(`${data.variant==="updated"?"Programación actualizada":"Programación aprobada"} · Versión ${data.version}`,regular,8,y)-2;
    y=center(`Generado: ${dateTime.format(data.generatedAt)} · ${data.timezone}`,regular,8,y)-12;
  }
  function heading(round:number,continued=false) {
    if(y<130)newPage();
    y=center(`JORNADA ${round}${continued?" · CONTINUACIÓN":""}`,bold,11,y)-7;
    row(["LOCAL","VISITANTE","CANCHA","FECHA Y HORA"],true);
  }
  function row(values:string[],header=false) {
    const size=header?8:9,font=header?bold:regular,lineHeight=12;
    const lines=values.map((value,i)=>wrap(value,font,size,columns[i]-12));
    const rowHeight=Math.max(24,Math.max(...lines.map(l=>l.length))*lineHeight+10);
    let x=left;
    for(let i=0;i<columns.length;i++) {
      page.drawRectangle({x,y:y-rowHeight,width:columns[i],height:rowHeight,borderWidth:0.6,borderColor:muted,...(header?{color:shade}:{})});
      lines[i].forEach((text,j)=>page.drawText(text,{x:x+6,y:y-10-size-j*lineHeight,size,font,color:ink}));
      x+=columns[i];
    }
    y-=rowHeight;
  }
  newPage();
  const rounds=[...new Set([...data.matches.map(m=>m.round),...data.byes.map(b=>b.round)])].sort((a,b)=>a-b);
  for(const round of rounds) {
    heading(round);
    const matches=data.matches.filter(m=>m.round===round).sort((a,b)=>(a.start?Date.parse(a.start):Infinity)-(b.start?Date.parse(b.start):Infinity)||a.home.localeCompare(b.home));
    const items=[...matches.map(match=>[match.home,match.away,match.venue,`${match.status==="CANCELED"?"Cancelado · ":""}${match.start?dateTime.format(new Date(match.start)):"Horario pendiente"}`]),...data.byes.filter(bye=>bye.round===round).map(bye=>[bye.team,"DESCANSA","—","—"])];
    for(const values of items) {
      const needed=Math.max(24,Math.max(...values.map((value,i)=>wrap(value,regular,9,columns[i]-12).length))*12+10);
      if(y-needed<48){newPage();heading(round,true);}
      row(values);
    }
    y-=18;
  }
  const pages=pdf.getPages();pages.forEach((target,index)=>target.drawText(`Página ${index+1} de ${pages.length}`,{x:left,y:25,size:8,font:regular,color:muted}));
  return pdf.save();
}

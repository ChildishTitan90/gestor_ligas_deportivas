"use client";
import {useRef} from "react";
import {ImagePlus,Upload} from "lucide-react";

/** Selección individual en memoria; el padre conserva el archivo y decide cuándo enviarlo. */
export function FilePickerButton({id,name,accept,photo=false,selected=false,disabled=false,describedBy,onSelect}:{
  id:string;name?:string;accept:string;photo?:boolean;selected?:boolean;disabled?:boolean;describedBy?:string;onSelect:(file:File)=>void;
}){
  const input=useRef<HTMLInputElement>(null);
  const label=photo?(selected?"Cambiar foto":"Elegir foto"):(selected?"Cambiar archivo":"Elegir archivo");
  const Icon=photo?ImagePlus:Upload;
  return <div>
    <input ref={input} id={id} name={name} type="file" accept={accept} hidden disabled={disabled} aria-label={label} aria-describedby={describedBy}
      onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)onSelect(file);}}/>
    <button type="button" disabled={disabled} aria-controls={id} aria-describedby={describedBy} onClick={()=>input.current?.click()}
      className={`${selected?"border border-border bg-surface text-primary":"primary-action"} inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold disabled:opacity-50`}>
      <Icon size={20} aria-hidden="true"/>{label}
    </button>
  </div>;
}

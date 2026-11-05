/** Rectángulo fuente que coincide con object-fit:cover y la guía centrada. */
export function cameraCrop(width:number,height:number,viewWidth:number,viewHeight:number,inset=0){
  if([width,height,viewWidth,viewHeight].some(n=>!Number.isFinite(n)||n<=0) || inset<0 || inset>=.5)throw new Error("INVALID_CAMERA_FRAME");
  const scale=Math.max(viewWidth/width,viewHeight/height);
  const visibleWidth=viewWidth/scale,visibleHeight=viewHeight/scale;
  return {x:(width-visibleWidth)/2+visibleWidth*inset,y:(height-visibleHeight)/2+visibleHeight*inset,width:visibleWidth*(1-2*inset),height:visibleHeight*(1-2*inset)};
}

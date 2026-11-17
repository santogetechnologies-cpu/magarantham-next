// Code 39 narrow/wide widths from BWIPP (MIT). See THIRD-PARTY-NOTICES.md.
const enc:Record<string,string>={'0':'1113313111','1':'3113111131','2':'1133111131','3':'3133111111','4':'1113311131','5':'3113311111','6':'1133311111','7':'1113113131','8':'3113113111','9':'1133113111',M:'3131111311',S:'1131113311',U:'3311111131','*':'1311313111'};
export function unitBarcode(code:string){if(!/^MSU[0-9]{12}$/.test(code))throw new Error('Invalid unit barcode');let x=12;const bars:{x:number;width:number}[]=[];for(const c of `*${code}*`){const pattern=enc[c];for(let i=0;i<pattern.length;i++){const width=Number(pattern[i]);if(i%2===0)bars.push({x,width});x+=width;}}return {bars,width:x+12};}
export function csvCell(value:unknown){const text=String(value??'');return `"${(/^[=+@\-\t\r]/.test(text)?"'":'')+text.replaceAll('"','""')}"`;}
export const indiaDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

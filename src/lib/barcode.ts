// Code 39 narrow/wide widths from BWIPP (MIT). See THIRD-PARTY-NOTICES.md.
const enc:Record<string,string>={'0':'1113313111','1':'3113111131','2':'1133111131','3':'3133111111','4':'1113311131','5':'3113311111','6':'1133311111','7':'1113113131','8':'3113113111','9':'1133113111',A:'3111131131',B:'1131131131',C:'3131131111',D:'1111331131',E:'3111331111',F:'1131331111',G:'1111133131',H:'3111133111',I:'1131133111',J:'1111333111',K:'3111111331',L:'1131111331',M:'3131111311',N:'1111311331',O:'3111311311',P:'1131311311',Q:'1111113331',R:'3111113311',S:'1131113311',T:'1111313311',U:'3311111131',V:'1331111131',W:'3331111111',X:'1311311131',Y:'3311311111',Z:'1331311111','-':'1311113131','.':'3311113111',' ':'1331113111','$':'1313131111','/':'1313111311','+':'1311131311','%':'1113131311','*':'1311313111'};
export function unitBarcode(code:string){if(!/^MSU[0-9]{12}$/.test(code))throw new Error('Invalid unit barcode');let x=12;const bars:{x:number;width:number}[]=[];for(const c of `*${code}*`){const pattern=enc[c];for(let i=0;i<pattern.length;i++){const width=Number(pattern[i]);if(i%2===0)bars.push({x,width});x+=width;}}return {bars,width:x+12};}
export function code39Barcode(raw:string){const code=raw.toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g,'').slice(0,32)||'MS-000';let x=12;const bars:{x:number;width:number}[]=[];for(const c of `*${code}*`){const pattern=enc[c];if(!pattern)continue;for(let i=0;i<pattern.length;i++){const width=Number(pattern[i]);if(i%2===0)bars.push({x,width});x+=width;}x+=1;}return {code,bars,width:x+12};}
export function csvCell(value:unknown){const text=String(value??'');return `"${(/^[=+@\-\t\r]/.test(text)?"'":'')+text.replaceAll('"','""')}"`;}
export const indiaDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

// ---------------------------------------------------------------------------
// Code 128 (ISO/IEC 15417): the retail standard every scanner reads by default.
// Digit runs are packed two per symbol (code set C), so labels print with bars
// about twice as thick as Code 39 for the same text and scan first time.
// Each pattern is bar,space,bar,space,bar,space module widths (stop has 7).
// ---------------------------------------------------------------------------
export const CODE128_PATTERNS = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
const START_B = 104, START_C = 105, TO_B = 100, TO_C = 99, STOP = 106;

/** Code 128 symbol values for text (printable ASCII), switching to set C for digit runs. */
export function code128Values(raw: string): number[] {
  const text = raw.replace(/[^\x20-\x7e]/g, '').slice(0, 48) || '0';
  const digitRun = (i: number) => { let n = 0; while (i + n < text.length && text[i + n] >= '0' && text[i + n] <= '9') n++; return n; };
  const values: number[] = [];
  let set: 'B' | 'C' = digitRun(0) >= 4 && digitRun(0) % 2 === 0 || digitRun(0) === text.length && text.length >= 2 && text.length % 2 === 0 ? 'C' : 'B';
  values.push(set === 'C' ? START_C : START_B);
  let i = 0;
  while (i < text.length) {
    const run = digitRun(i);
    if (set === 'C') {
      if (run >= 2) { values.push(Number(text.slice(i, i + 2))); i += 2; continue; }
      values.push(TO_B); set = 'B'; continue;
    }
    // In set B: switch to C for long digit runs (6+ mid-text, 4+ at the end)
    if (run >= 6 || (run >= 4 && i + run === text.length)) {
      if (run % 2 === 1) { values.push(text.charCodeAt(i) - 32); i++; }
      values.push(TO_C); set = 'C'; continue;
    }
    values.push(text.charCodeAt(i) - 32); i++;
  }
  const check = values.reduce((sum, v, k) => sum + v * (k === 0 ? 1 : k), 0) % 103;
  values.push(check, STOP);
  return values;
}

/** Bars for an SVG label: x/width in modules, 10-module quiet zones on both sides. */
export function code128Barcode(raw: string) {
  const values = code128Values(raw);
  let x = 10;
  const bars: { x: number; width: number }[] = [];
  for (const v of values) {
    const p = CODE128_PATTERNS[v];
    for (let k = 0; k < p.length; k++) {
      const w = Number(p[k]);
      if (k % 2 === 0) bars.push({ x, width: w });
      x += w;
    }
  }
  return { code: raw.replace(/[^\x20-\x7e]/g, '').slice(0, 48), bars, width: x + 10 };
}

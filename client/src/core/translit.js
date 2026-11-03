// English → Devanagari name transliteration. Uses the LAN server's Google Input Tools proxy when it is
// reachable; otherwise a dictionary of common Rajasthani names + phonetic rules (always editable).
import { api, isServer } from './sync';

const NAMES = {
  mrs: 'श्रीमती', smt: 'श्रीमती', kumari: 'कुमारी', devi: 'देवी', bai: 'बाई', kanwar: 'कंवर', kunwar: 'कुंवर', meena: 'मीना', mina: 'मीना', rekha: 'रेखा', sunita: 'सुनीता',
  anita: 'अनीता', kavita: 'कविता', savita: 'सविता', geeta: 'गीता', gita: 'गीता', seema: 'सीमा', sima: 'सीमा', neha: 'नेहा', pooja: 'पूजा', puja: 'पूजा', priya: 'प्रिया',
  priyanka: 'प्रियंका', rani: 'रानी', lata: 'लता', manju: 'मंजू', santosh: 'संतोष', sharda: 'शारदा', sushila: 'सुशीला', kamla: 'कमला', kamala: 'कमला', shanti: 'शांति',
  suman: 'सुमन', mamta: 'ममता', mamata: 'ममता', radha: 'राधा', sita: 'सीता', laxmi: 'लक्ष्मी', lakshmi: 'लक्ष्मी', saroj: 'सरोज', usha: 'उषा', asha: 'आशा', nisha: 'निशा',
  rinku: 'रिंकू', pinky: 'पिंकी', sonu: 'सोनू', monika: 'मोनिका', komal: 'कोमल', jyoti: 'ज्योति', anjali: 'अंजली', kiran: 'किरण', poonam: 'पूनम', sangeeta: 'संगीता',
  sapna: 'सपना', vimla: 'विमला', vandana: 'वंदना', nirmala: 'निर्मला', kusum: 'कुसुम', guddi: 'गुड्डी', dimple: 'डिंपल', payal: 'पायल', mohini: 'मोहिनी', tara: 'तारा',
  ram: 'राम', shyam: 'श्याम', ghanshyam: 'घनश्याम', rakesh: 'राकेश', mahesh: 'महेश', suresh: 'सुरेश', ramesh: 'रमेश', dinesh: 'दिनेश', mukesh: 'मुकेश', naresh: 'नरेश',
  rajesh: 'राजेश', amit: 'अमित', sumit: 'सुमित', vikram: 'विक्रम', vijay: 'विजय', ajay: 'अजय', sanjay: 'संजय', manoj: 'मनोज', kailash: 'कैलाश', prakash: 'प्रकाश',
  om: 'ओम', mohan: 'मोहन', sohan: 'सोहन', lal: 'लाल', gopal: 'गोपाल', govind: 'गोविंद', hanuman: 'हनुमान', sahay: 'सहाय', narayan: 'नारायण', prasad: 'प्रसाद',
  kumar: 'कुमार', singh: 'सिंह', sharma: 'शर्मा', verma: 'वर्मा', gupta: 'गुप्ता', agarwal: 'अग्रवाल', aggarwal: 'अग्रवाल', jain: 'जैन', yadav: 'यादव', meghwal: 'मेघवाल',
  choudhary: 'चौधरी', chaudhary: 'चौधरी', saini: 'सैनी', kumawat: 'कुमावत', jat: 'जाट', gurjar: 'गुर्जर', rajput: 'राजपूत', shekhawat: 'शेखावत', rathore: 'राठौड़',
  khandelwal: 'खंडेलवाल', soni: 'सोनी', mali: 'माली', bairwa: 'बैरवा', regar: 'रेगर', prajapat: 'प्रजापत', swami: 'स्वामी', joshi: 'जोशी', tiwari: 'तिवारी', mishra: 'मिश्रा',
  pareek: 'पारीक', khan: 'खान', bano: 'बानो', begum: 'बेगम', mohammad: 'मोहम्मद', late: 'स्वर्गीय', bhanwar: 'भंवर', mahendra: 'महेंद्र', surendra: 'सुरेंद्र', jitendra: 'जितेंद्र',
  hemlata: 'हेमलता', pushpa: 'पुष्पा', dhapu: 'धापू', bhagwati: 'भगवती', bhawna: 'भावना', bhavna: 'भावना', krishna: 'कृष्णा', kesar: 'केसर', sushma: 'सुषमा', manisha: 'मनीषा',
  sarita: 'सरिता', babita: 'बबीता', ritu: 'रितु', reena: 'रीना', rina: 'रीना', tina: 'टीना', meera: 'मीरा', mira: 'मीरा', durga: 'दुर्गा', parvati: 'पार्वती', ganga: 'गंगा',
  yamuna: 'यमुना', chanda: 'चंदा', chandra: 'चंद्र', chand: 'चंद', prem: 'प्रेम', shankar: 'शंकर', shiv: 'शिव', ganesh: 'गणेश', laxman: 'लक्ष्मण', bhagirath: 'भागीरथ',
  kamlesh: 'कमलेश', bhanwari: 'भंवरी', bhagchand: 'भागचंद', kanhaiya: 'कन्हैया', banwari: 'बनवारी', ghasi: 'घासी', gopi: 'गोपी', hari: 'हरि', mangilal: 'मांगीलाल', mangi: 'मांगी'
};

const CONS = [
  ['ksh', 'क्ष'], ['chh', 'छ'], ['shr', 'श्र'], ['tr', 'त्र'], ['gy', 'ग्य'],
  ['kh', 'ख'], ['gh', 'घ'], ['ch', 'च'], ['jh', 'झ'], ['th', 'थ'], ['dh', 'ध'], ['ph', 'फ'], ['bh', 'भ'], ['sh', 'श'], ['ck', 'क'],
  ['k', 'क'], ['g', 'ग'], ['c', 'क'], ['j', 'ज'], ['t', 'त'], ['d', 'द'], ['n', 'न'], ['p', 'प'], ['b', 'ब'], ['m', 'म'], ['y', 'य'], ['r', 'र'],
  ['l', 'ल'], ['v', 'व'], ['w', 'व'], ['s', 'स'], ['h', 'ह'], ['f', 'फ़'], ['z', 'ज़'], ['q', 'क'], ['x', 'क्स']
];
const VOW = [['aa', 'आ', 'ा'], ['ai', 'ऐ', 'ै'], ['au', 'औ', 'ौ'], ['ee', 'ई', 'ी'], ['ii', 'ई', 'ी'], ['oo', 'ऊ', 'ू'], ['a', 'अ', ''], ['i', 'इ', 'ि'], ['u', 'उ', 'ु'], ['e', 'ए', 'े'], ['o', 'ओ', 'ो']];
const HALANT = '्';
const STOPS = new Set(['k', 'kh', 'g', 'gh', 'c', 'ch', 'chh', 'j', 'jh', 't', 'th', 'tr', 'd', 'dh', 'p', 'ph', 'b', 'bh']);

function matchAt(w, i, table) { for (const row of table) if (w.startsWith(row[0], i)) return row; return null; }

function ruleWord(w) {
  let out = '';
  let i = 0;
  let afterCons = false;
  while (i < w.length) {
    const c = matchAt(w, i, CONS);
    if (c) {
      if (afterCons) out += HALANT;
      // nasal before a consonant → anusvara (e.g. "sangeeta" → संगीता)
      const nx = (c[0] === 'n' || c[0] === 'm') && !afterCons && out ? matchAt(w, i + 1, CONS) : null;
      if (nx && STOPS.has(nx[0])) {
        out += 'ं'; i += c[0].length; afterCons = false; continue;
      }
      out += c[1]; i += c[0].length; afterCons = true; continue;
    }
    const v = matchAt(w, i, VOW);
    if (v) {
      const last = i + v[0].length >= w.length;
      if (afterCons) out += last && v[0] === 'a' ? 'ा' : last && v[0] === 'i' ? 'ी' : v[2];
      else out += v[1];
      i += v[0].length; afterCons = false; continue;
    }
    out += w[i]; i += 1; afterCons = false;
  }
  return out;
}

export function transliterateOffline(text) {
  return String(text || '').split(/(\s+|[.,/-])/).map((tok) => {
    const k = tok.toLowerCase();
    if (!/^[a-z]+$/.test(k)) return tok === '.' ? '' : tok;
    return NAMES[k] || ruleWord(k);
  }).join('').replace(/\s+/g, ' ').trim();
}

export async function toHindi(text) {
  if (!String(text || '').trim()) return '';
  if (isServer()) {
    try {
      const r = await api('ai/translit?text=' + encodeURIComponent(text), { timeout: 6000 });
      if (r && r.result && /[ऀ-ॿ]/.test(r.result)) return r.result;
    } catch (e) { /* offline – fall back to rules */ }
  }
  return transliterateOffline(text);
}

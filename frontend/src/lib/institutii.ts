// Romanian court institutions parsed from SOAP WSDL enum values
// Auto-generated data file - 246 institutions

export interface Institutie {
  value: string;
  label: string;
  group: string;
}

export const INSTITUTII_GROUPS = [
  'Curți de Apel',
  'Tribunale',
  'Tribunale Specializate',
  'Tribunale Comerciale',
  'Tribunale Militare',
  'Curți Militare',
  'Judecătorii',
] as const;

export type InstitutieGroup = (typeof INSTITUTII_GROUPS)[number];

// Resolve a stored institutie value (e.g. "TribunalulBUCURESTI") to its
// human-friendly label (e.g. "Tribunalul București"). Falls back to the raw
// value if the catalog does not contain it (defensive: covers stale jobs whose
// target_json predates a catalog rename).
export function getInstitutieLabel(val: string): string {
  return INSTITUTII.find((i) => i.value === val)?.label ?? val;
}

export const INSTITUTII: Institutie[] = [
  // ── Curți de Apel ──────────────────────────────────────────────────
  { value: 'CurteadeApelALBAIULIA', label: 'Curtea de Apel Alba Iulia', group: 'Curți de Apel' },
  { value: 'CurteadeApelBACAU', label: 'Curtea de Apel Bacău', group: 'Curți de Apel' },
  { value: 'CurteadeApelBRASOV', label: 'Curtea de Apel Brașov', group: 'Curți de Apel' },
  { value: 'CurteadeApelBUCURESTI', label: 'Curtea de Apel București', group: 'Curți de Apel' },
  { value: 'CurteadeApelCLUJ', label: 'Curtea de Apel Cluj', group: 'Curți de Apel' },
  { value: 'CurteadeApelCONSTANTA', label: 'Curtea de Apel Constanța', group: 'Curți de Apel' },
  { value: 'CurteadeApelCRAIOVA', label: 'Curtea de Apel Craiova', group: 'Curți de Apel' },
  { value: 'CurteadeApelGALATI', label: 'Curtea de Apel Galați', group: 'Curți de Apel' },
  { value: 'CurteadeApelIASI', label: 'Curtea de Apel Iași', group: 'Curți de Apel' },
  { value: 'CurteadeApelORADEA', label: 'Curtea de Apel Oradea', group: 'Curți de Apel' },
  { value: 'CurteadeApelPITESTI', label: 'Curtea de Apel Pitești', group: 'Curți de Apel' },
  { value: 'CurteadeApelPLOIESTI', label: 'Curtea de Apel Ploiești', group: 'Curți de Apel' },
  { value: 'CurteadeApelSUCEAVA', label: 'Curtea de Apel Suceava', group: 'Curți de Apel' },
  { value: 'CurteadeApelTARGUMURES', label: 'Curtea de Apel Târgu Mureș', group: 'Curți de Apel' },
  { value: 'CurteadeApelTIMISOARA', label: 'Curtea de Apel Timișoara', group: 'Curți de Apel' },

  // ── Tribunale ──────────────────────────────────────────────────────
  { value: 'TribunalulALBA', label: 'Tribunalul Alba', group: 'Tribunale' },
  { value: 'TribunalulARAD', label: 'Tribunalul Arad', group: 'Tribunale' },
  { value: 'TribunalulARGES', label: 'Tribunalul Argeș', group: 'Tribunale' },
  { value: 'TribunalulBACAU', label: 'Tribunalul Bacău', group: 'Tribunale' },
  { value: 'TribunalulBIHOR', label: 'Tribunalul Bihor', group: 'Tribunale' },
  { value: 'TribunalulBISTRITANASAUD', label: 'Tribunalul Bistrița-Năsăud', group: 'Tribunale' },
  { value: 'TribunalulBOTOSANI', label: 'Tribunalul Botoșani', group: 'Tribunale' },
  { value: 'TribunalulBRAILA', label: 'Tribunalul Brăila', group: 'Tribunale' },
  { value: 'TribunalulBRASOV', label: 'Tribunalul Brașov', group: 'Tribunale' },
  { value: 'TribunalulBUCURESTI', label: 'Tribunalul București', group: 'Tribunale' },
  { value: 'TribunalulBUZAU', label: 'Tribunalul Buzău', group: 'Tribunale' },
  { value: 'TribunalulCALARASI', label: 'Tribunalul Călărași', group: 'Tribunale' },
  { value: 'TribunalulCARASSEVERIN', label: 'Tribunalul Caraș-Severin', group: 'Tribunale' },
  { value: 'TribunalulCLUJ', label: 'Tribunalul Cluj', group: 'Tribunale' },
  { value: 'TribunalulCONSTANTA', label: 'Tribunalul Constanța', group: 'Tribunale' },
  { value: 'TribunalulCOVASNA', label: 'Tribunalul Covasna', group: 'Tribunale' },
  { value: 'TribunalulDAMBOVITA', label: 'Tribunalul Dâmbovița', group: 'Tribunale' },
  { value: 'TribunalulDOLJ', label: 'Tribunalul Dolj', group: 'Tribunale' },
  { value: 'TribunalulGALATI', label: 'Tribunalul Galați', group: 'Tribunale' },
  { value: 'TribunalulGIURGIU', label: 'Tribunalul Giurgiu', group: 'Tribunale' },
  { value: 'TribunalulGORJ', label: 'Tribunalul Gorj', group: 'Tribunale' },
  { value: 'TribunalulHARGHITA', label: 'Tribunalul Harghita', group: 'Tribunale' },
  { value: 'TribunalulHUNEDOARA', label: 'Tribunalul Hunedoara', group: 'Tribunale' },
  { value: 'TribunalulIALOMITA', label: 'Tribunalul Ialomița', group: 'Tribunale' },
  { value: 'TribunalulIASI', label: 'Tribunalul Iași', group: 'Tribunale' },
  { value: 'TribunalulILFOV', label: 'Tribunalul Ilfov', group: 'Tribunale' },
  { value: 'TribunalulMARAMURES', label: 'Tribunalul Maramureș', group: 'Tribunale' },
  { value: 'TribunalulMEHEDINTI', label: 'Tribunalul Mehedinți', group: 'Tribunale' },
  { value: 'TribunalulMURES', label: 'Tribunalul Mureș', group: 'Tribunale' },
  { value: 'TribunalulNEAMT', label: 'Tribunalul Neamț', group: 'Tribunale' },
  { value: 'TribunalulOLT', label: 'Tribunalul Olt', group: 'Tribunale' },
  { value: 'TribunalulPRAHOVA', label: 'Tribunalul Prahova', group: 'Tribunale' },
  { value: 'TribunalulSALAJ', label: 'Tribunalul Sălaj', group: 'Tribunale' },
  { value: 'TribunalulSATUMARE', label: 'Tribunalul Satu Mare', group: 'Tribunale' },
  { value: 'TribunalulSIBIU', label: 'Tribunalul Sibiu', group: 'Tribunale' },
  { value: 'TribunalulSUCEAVA', label: 'Tribunalul Suceava', group: 'Tribunale' },
  { value: 'TribunalulTELEORMAN', label: 'Tribunalul Teleorman', group: 'Tribunale' },
  { value: 'TribunalulTIMIS', label: 'Tribunalul Timiș', group: 'Tribunale' },
  { value: 'TribunalulTULCEA', label: 'Tribunalul Tulcea', group: 'Tribunale' },
  { value: 'TribunalulVALCEA', label: 'Tribunalul Vâlcea', group: 'Tribunale' },
  { value: 'TribunalulVASLUI', label: 'Tribunalul Vaslui', group: 'Tribunale' },
  { value: 'TribunalulVRANCEA', label: 'Tribunalul Vrancea', group: 'Tribunale' },

  // ── Tribunale Specializate ─────────────────────────────────────────
  { value: 'TribunalulpentruminoriSifamilieBRASOV', label: 'Tribunalul pentru Minori și Familie Brașov', group: 'Tribunale Specializate' },

  // ── Tribunale Comerciale ───────────────────────────────────────────
  { value: 'TribunalulComercialARGES', label: 'Tribunalul Comercial Argeș', group: 'Tribunale Comerciale' },
  { value: 'TribunalulComercialCLUJ', label: 'Tribunalul Comercial Cluj', group: 'Tribunale Comerciale' },
  { value: 'TribunalulComercialMURES', label: 'Tribunalul Comercial Mureș', group: 'Tribunale Comerciale' },

  // ── Tribunale Militare ─────────────────────────────────────────────
  { value: 'TribunalulMilitarBUCURESTI', label: 'Tribunalul Militar București', group: 'Tribunale Militare' },
  { value: 'TribunalulMilitarCLUJNAPOCA', label: 'Tribunalul Militar Cluj-Napoca', group: 'Tribunale Militare' },
  { value: 'TribunalulMilitarIASI', label: 'Tribunalul Militar Iași', group: 'Tribunale Militare' },
  { value: 'TribunalulMilitarTIMISOARA', label: 'Tribunalul Militar Timișoara', group: 'Tribunale Militare' },
  { value: 'TribunalulMilitarTeritorialBUCURESTI', label: 'Tribunalul Militar Teritorial București', group: 'Tribunale Militare' },

  // ── Curți Militare ─────────────────────────────────────────────────
  { value: 'CurteaMilitaradeApelBUCURESTI', label: 'Curtea Militară de Apel București', group: 'Curți Militare' },

  // ── Judecătorii ────────────────────────────────────────────────────
  { value: 'JudecatoriaADJUD', label: 'Judecătoria Adjud', group: 'Judecătorii' },
  { value: 'JudecatoriaAGNITA', label: 'Judecătoria Agnita', group: 'Judecătorii' },
  { value: 'JudecatoriaAIUD', label: 'Judecătoria Aiud', group: 'Judecătorii' },
  { value: 'JudecatoriaALBAIULIA', label: 'Judecătoria Alba Iulia', group: 'Judecătorii' },
  { value: 'JudecatoriaALESD', label: 'Judecătoria Aleșd', group: 'Judecătorii' },
  { value: 'JudecatoriaALEXANDRIA', label: 'Judecătoria Alexandria', group: 'Judecătorii' },
  { value: 'JudecatoriaARAD', label: 'Judecătoria Arad', group: 'Judecătorii' },
  { value: 'JudecatoriaAVRIG', label: 'Judecătoria Avrig', group: 'Judecătorii' },
  { value: 'JudecatoriaBABADAG', label: 'Judecătoria Babadag', group: 'Judecătorii' },
  { value: 'JudecatoriaBACAU', label: 'Judecătoria Bacău', group: 'Judecătorii' },
  { value: 'JudecatoriaBAIADEARAMA', label: 'Judecătoria Baia de Aramă', group: 'Judecătorii' },
  { value: 'JudecatoriaBAIAMARE', label: 'Judecătoria Baia Mare', group: 'Judecătorii' },
  { value: 'JudecatoriaBAILESTI', label: 'Judecătoria Băilești', group: 'Judecătorii' },
  { value: 'JudecatoriaBALCESTI', label: 'Judecătoria Bălcești', group: 'Judecătorii' },
  { value: 'JudecatoriaBALS', label: 'Judecătoria Balș', group: 'Judecătorii' },
  { value: 'JudecatoriaBARLAD', label: 'Judecătoria Bârlad', group: 'Judecătorii' },
  { value: 'JudecatoriaBECLEAN', label: 'Judecătoria Beclean', group: 'Judecătorii' },
  { value: 'JudecatoriaBEIUS', label: 'Judecătoria Beiuș', group: 'Judecătorii' },
  { value: 'JudecatoriaBICAZ', label: 'Judecătoria Bicaz', group: 'Judecătorii' },
  { value: 'JudecatoriaBISTRITA', label: 'Judecătoria Bistrița', group: 'Judecătorii' },
  { value: 'JudecatoriaBLAJ', label: 'Judecătoria Blaj', group: 'Judecătorii' },
  { value: 'JudecatoriaBOLINTINVALE', label: 'Judecătoria Bolintin-Vale', group: 'Judecătorii' },
  { value: 'JudecatoriaBOTOSANI', label: 'Judecătoria Botoșani', group: 'Judecătorii' },
  { value: 'JudecatoriaBOZOVICI', label: 'Judecătoria Bozovici', group: 'Judecătorii' },
  { value: 'JudecatoriaBRAD', label: 'Judecătoria Brad', group: 'Judecătorii' },
  { value: 'JudecatoriaBRAILA', label: 'Judecătoria Brăila', group: 'Judecătorii' },
  { value: 'JudecatoriaBRASOV', label: 'Judecătoria Brașov', group: 'Judecătorii' },
  { value: 'JudecatoriaBREZOI', label: 'Judecătoria Brezoi', group: 'Judecătorii' },
  { value: 'JudecatoriaBUFTEA', label: 'Judecătoria Buftea', group: 'Judecătorii' },
  { value: 'JudecatoriaBUHUSI', label: 'Judecătoria Buhuși', group: 'Judecătorii' },
  { value: 'JudecatoriaBUZAU', label: 'Judecătoria Buzău', group: 'Judecătorii' },
  { value: 'JudecatoriaCALAFAT', label: 'Judecătoria Calafat', group: 'Judecătorii' },
  { value: 'JudecatoriaCALARASI', label: 'Judecătoria Călărași', group: 'Judecătorii' },
  { value: 'JudecatoriaCAMPENI', label: 'Judecătoria Câmpeni', group: 'Judecătorii' },
  { value: 'JudecatoriaCAMPINA', label: 'Judecătoria Câmpina', group: 'Judecătorii' },
  { value: 'JudecatoriaCAMPULUNG', label: 'Judecătoria Câmpulung', group: 'Judecătorii' },
  { value: 'JudecatoriaCAMPULUNGMOLDOVENESC', label: 'Judecătoria Câmpulung Moldovenesc', group: 'Judecătorii' },
  { value: 'JudecatoriaCARACAL', label: 'Judecătoria Caracal', group: 'Judecătorii' },
  { value: 'JudecatoriaCARANSEBES', label: 'Judecătoria Caransebeș', group: 'Judecătorii' },
  { value: 'JudecatoriaCAREI', label: 'Judecătoria Carei', group: 'Judecătorii' },
  { value: 'JudecatoriaCHISINEUCRIS', label: 'Judecătoria Chișineu-Criș', group: 'Judecătorii' },
  { value: 'JudecatoriaCLUJNAPOCA', label: 'Judecătoria Cluj-Napoca', group: 'Judecătorii' },
  { value: 'JudecatoriaCONSTANTA', label: 'Judecătoria Constanța', group: 'Judecătorii' },
  { value: 'JudecatoriaCORABIA', label: 'Judecătoria Corabia', group: 'Judecătorii' },
  { value: 'JudecatoriaCORNETU', label: 'Judecătoria Cornetu', group: 'Judecătorii' },
  { value: 'JudecatoriaCOSTESTI', label: 'Judecătoria Costești', group: 'Judecătorii' },
  { value: 'JudecatoriaCRAIOVA', label: 'Judecătoria Craiova', group: 'Judecătorii' },
  { value: 'JudecatoriaCURTEADEARGES', label: 'Judecătoria Curtea de Argeș', group: 'Judecătorii' },
  { value: 'JudecatoriaDarabani', label: 'Judecătoria Darabani', group: 'Judecătorii' },
  { value: 'JudecatoriaDEJ', label: 'Judecătoria Dej', group: 'Judecătorii' },
  { value: 'JudecatoriaDETA', label: 'Judecătoria Deta', group: 'Judecătorii' },
  { value: 'JudecatoriaDEVA', label: 'Judecătoria Deva', group: 'Judecătorii' },
  { value: 'JudecatoriaDOROHOI', label: 'Judecătoria Dorohoi', group: 'Judecătorii' },
  { value: 'JudecatoriaDRAGASANI', label: 'Judecătoria Drăgășani', group: 'Judecătorii' },
  { value: 'JudecatoriaDRAGOMIRESTI', label: 'Judecătoria Dragomirești', group: 'Judecătorii' },
  { value: 'JudecatoriaDROBETATURNUSEVERIN', label: 'Judecătoria Drobeta-Turnu Severin', group: 'Judecătorii' },
  { value: 'JudecatoriaFAGARAS', label: 'Judecătoria Făgăraș', group: 'Judecătorii' },
  { value: 'JudecatoriaFAGET', label: 'Judecătoria Făget', group: 'Judecătorii' },
  { value: 'JudecatoriaFALTICENI', label: 'Judecătoria Fălticeni', group: 'Judecătorii' },
  { value: 'JudecatoriaFAUREI', label: 'Judecătoria Făurei', group: 'Judecătorii' },
  { value: 'JudecatoriaFETESTI', label: 'Judecătoria Fetești', group: 'Judecătorii' },
  { value: 'JudecatoriaFILIASI', label: 'Judecătoria Filiași', group: 'Judecătorii' },
  { value: 'JudecatoriaFOCSANI', label: 'Judecătoria Focșani', group: 'Judecătorii' },
  { value: 'JudecatoriaGAESTI', label: 'Judecătoria Găești', group: 'Judecătorii' },
  { value: 'JudecatoriaGALATI', label: 'Judecătoria Galați', group: 'Judecătorii' },
  { value: 'JudecatoriaGHEORGHENI', label: 'Judecătoria Gheorgheni', group: 'Judecătorii' },
  { value: 'JudecatoriaGHERLA', label: 'Judecătoria Gherla', group: 'Judecătorii' },
  { value: 'JudecatoriaGIURGIU', label: 'Judecătoria Giurgiu', group: 'Judecătorii' },
  { value: 'JudecatoriaGURAHONT', label: 'Judecătoria Gurahonț', group: 'Judecătorii' },
  { value: 'JudecatoriaGURAHUMORULUI', label: 'Judecătoria Gura Humorului', group: 'Judecătorii' },
  { value: 'JudecatoriaHARLAU', label: 'Judecătoria Hârlău', group: 'Judecătorii' },
  { value: 'JudecatoriaHARSOVA', label: 'Judecătoria Hârșova', group: 'Judecătorii' },
  { value: 'JudecatoriaHATEG', label: 'Judecătoria Hațeg', group: 'Judecătorii' },
  { value: 'JudecatoriaHOREZU', label: 'Judecătoria Horezu', group: 'Judecătorii' },
  { value: 'JudecatoriaHUEDIN', label: 'Judecătoria Huedin', group: 'Judecătorii' },
  { value: 'JudecatoriaHUNEDOARA', label: 'Judecătoria Hunedoara', group: 'Judecătorii' },
  { value: 'JudecatoriaHUSI', label: 'Judecătoria Huși', group: 'Judecătorii' },
  { value: 'JudecatoriaIASI', label: 'Judecătoria Iași', group: 'Judecătorii' },
  { value: 'JudecatoriaINEU', label: 'Judecătoria Ineu', group: 'Judecătorii' },
  { value: 'JudecatoriaINSURATEI', label: 'Judecătoria Însurăței', group: 'Judecătorii' },
  { value: 'JudecatoriaINTORSURABUZAULUI', label: 'Judecătoria Întorsura Buzăului', group: 'Judecătorii' },
  { value: 'JudecatoriaJIBOU', label: 'Judecătoria Jibou', group: 'Judecătorii' },
  { value: 'JudecatoriaLEHLIUGARA', label: 'Judecătoria Lehliu-Gară', group: 'Judecătorii' },
  { value: 'JudecatoriaLIESTI', label: 'Judecătoria Liești', group: 'Judecătorii' },
  { value: 'JudecatoriaLIPOVA', label: 'Judecătoria Lipova', group: 'Judecătorii' },
  { value: 'JudecatoriaLUDUS', label: 'Judecătoria Luduș', group: 'Judecătorii' },
  { value: 'JudecatoriaLUGOJ', label: 'Judecătoria Lugoj', group: 'Judecătorii' },
  { value: 'JudecatoriaMACIN', label: 'Judecătoria Măcin', group: 'Judecătorii' },
  { value: 'JudecatoriaMANGALIA', label: 'Judecătoria Mangalia', group: 'Judecătorii' },
  { value: 'JudecatoriaMARGHITA', label: 'Judecătoria Marghita', group: 'Judecătorii' },
  { value: 'JudecatoriaMEDGIDIA', label: 'Judecătoria Medgidia', group: 'Judecătorii' },
  { value: 'JudecatoriaMEDIAS', label: 'Judecătoria Mediaș', group: 'Judecătorii' },
  { value: 'JudecatoriaMIERCUREACIUC', label: 'Judecătoria Miercurea Ciuc', group: 'Judecătorii' },
  { value: 'JudecatoriaMIZIL', label: 'Judecătoria Mizil', group: 'Judecătorii' },
  { value: 'JudecatoriaMOINESTI', label: 'Judecătoria Moinești', group: 'Judecătorii' },
  { value: 'JudecatoriaMOLDOVANOUA', label: 'Judecătoria Moldova Nouă', group: 'Judecătorii' },
  { value: 'JudecatoriaMORENI', label: 'Judecătoria Moreni', group: 'Judecătorii' },
  { value: 'JudecatoriaMOTRU', label: 'Judecătoria Motru', group: 'Judecătorii' },
  { value: 'JudecatoriaMURGENI', label: 'Judecătoria Murgeni', group: 'Judecătorii' },
  { value: 'JudecatoriaNASAUD', label: 'Judecătoria Năsăud', group: 'Judecătorii' },
  { value: 'JudecatoriaNEGRESTIOAS', label: 'Judecătoria Negrești-Oaș', group: 'Judecătorii' },
  { value: 'JudecatoriaNOVACI', label: 'Judecătoria Novaci', group: 'Judecătorii' },
  { value: 'JudecatoriaODORHEIULSECUIESC', label: 'Judecătoria Odorheiu Secuiesc', group: 'Judecătorii' },
  { value: 'JudecatoriaOLTENITA', label: 'Judecătoria Oltenița', group: 'Judecătorii' },
  { value: 'JudecatoriaONESTI', label: 'Judecătoria Onești', group: 'Judecătorii' },
  { value: 'JudecatoriaORADEA', label: 'Judecătoria Oradea', group: 'Judecătorii' },
  { value: 'JudecatoriaORASTIE', label: 'Judecătoria Orăștie', group: 'Judecătorii' },
  { value: 'JudecatoriaORAVITA', label: 'Judecătoria Oravița', group: 'Judecătorii' },
  { value: 'JudecatoriaORSOVA', label: 'Judecătoria Orșova', group: 'Judecătorii' },
  { value: 'JudecatoriaPANCIU', label: 'Judecătoria Panciu', group: 'Judecătorii' },
  { value: 'JudecatoriaPASCANI', label: 'Judecătoria Pașcani', group: 'Judecătorii' },
  { value: 'JudecatoriaPATARLAGELE', label: 'Judecătoria Pătârlagele', group: 'Judecătorii' },
  { value: 'JudecatoriaPETROSANI', label: 'Judecătoria Petroșani', group: 'Judecătorii' },
  { value: 'JudecatoriaPIATRANEAMT', label: 'Judecătoria Piatra Neamț', group: 'Judecătorii' },
  { value: 'JudecatoriaPITESTI', label: 'Judecătoria Pitești', group: 'Judecătorii' },
  { value: 'JudecatoriaPLOIESTI', label: 'Judecătoria Ploiești', group: 'Judecătorii' },
  { value: 'JudecatoriaPODUTURCULUI', label: 'Judecătoria Podu Turcului', group: 'Judecătorii' },
  { value: 'JudecatoriaPOGOANELE', label: 'Judecătoria Pogoanele', group: 'Judecătorii' },
  { value: 'JudecatoriaPUCIOASA', label: 'Judecătoria Pucioasa', group: 'Judecătorii' },
  { value: 'JudecatoriaRACARI', label: 'Judecătoria Răcari', group: 'Judecătorii' },
  { value: 'JudecatoriaRADAUTI', label: 'Judecătoria Rădăuți', group: 'Judecătorii' },
  { value: 'JudecatoriaRADUCANENI', label: 'Judecătoria Răducăneni', group: 'Judecătorii' },
  { value: 'JudecatoriaRAMNICUSARAT', label: 'Judecătoria Râmnicu Sărat', group: 'Judecătorii' },
  { value: 'JudecatoriaRAMNICUVALCEA', label: 'Judecătoria Râmnicu Vâlcea', group: 'Judecătorii' },
  { value: 'JudecatoriaREGHIN', label: 'Judecătoria Reghin', group: 'Judecătorii' },
  { value: 'JudecatoriaRESITA', label: 'Judecătoria Reșița', group: 'Judecătorii' },
  { value: 'JudecatoriaROMAN', label: 'Judecătoria Roman', group: 'Judecătorii' },
  { value: 'JudecatoriaROSIORIDEVEDE', label: 'Judecătoria Roșiori de Vede', group: 'Judecătorii' },
  { value: 'JudecatoriaRUPEA', label: 'Judecătoria Rupea', group: 'Judecătorii' },
  { value: 'JudecatoriaSALISTE', label: 'Judecătoria Săliște', group: 'Judecătorii' },
  { value: 'JudecatoriaSALONTA', label: 'Judecătoria Salonta', group: 'Judecătorii' },
  { value: 'JudecatoriaSANNICOLAULMARE', label: 'Judecătoria Sânnicolau Mare', group: 'Judecătorii' },
  { value: 'JudecatoriaSATUMARE', label: 'Judecătoria Satu Mare', group: 'Judecătorii' },
  { value: 'JudecatoriaSAVENI', label: 'Judecătoria Săveni', group: 'Judecătorii' },
  { value: 'JudecatoriaSEBES', label: 'Judecătoria Sebeș', group: 'Judecătorii' },
  { value: 'JudecatoriaSECTORUL1BUCURESTI', label: 'Judecătoria Sectorul 1 București', group: 'Judecătorii' },
  { value: 'JudecatoriaSECTORUL2BUCURESTI', label: 'Judecătoria Sectorul 2 București', group: 'Judecătorii' },
  { value: 'JudecatoriaSECTORUL3BUCURESTI', label: 'Judecătoria Sectorul 3 București', group: 'Judecătorii' },
  { value: 'JudecatoriaSECTORUL4BUCURESTI', label: 'Judecătoria Sectorul 4 București', group: 'Judecătorii' },
  { value: 'JudecatoriaSECTORUL5BUCURESTI', label: 'Judecătoria Sectorul 5 București', group: 'Judecătorii' },
  { value: 'JudecatoriaSECTORUL6BUCURESTI', label: 'Judecătoria Sectorul 6 București', group: 'Judecătorii' },
  { value: 'JudecatoriaSEGARCEA', label: 'Judecătoria Segarcea', group: 'Judecătorii' },
  { value: 'JudecatoriaSFANTUGHEORGHE', label: 'Judecătoria Sfântu Gheorghe', group: 'Judecătorii' },
  { value: 'JudecatoriaSIBIU', label: 'Judecătoria Sibiu', group: 'Judecătorii' },
  { value: 'JudecatoriaSIGHETUMARMATIEI', label: 'Judecătoria Sighetu Marmației', group: 'Judecătorii' },
  { value: 'JudecatoriaSIGHISOARA', label: 'Judecătoria Sighișoara', group: 'Judecătorii' },
  { value: 'JudecatoriaSIMLEULSILVANIEI', label: 'Judecătoria Șimleu Silvaniei', group: 'Judecătorii' },
  { value: 'JudecatoriaSINAIA', label: 'Judecătoria Sinaia', group: 'Judecătorii' },
  { value: 'JudecatoriaSLATINA', label: 'Judecătoria Slatina', group: 'Judecătorii' },
  { value: 'JudecatoriaSLOBOZIA', label: 'Judecătoria Slobozia', group: 'Judecătorii' },
  { value: 'JudecatoriaSOMCUTAMARE', label: 'Judecătoria Șomcuta Mare', group: 'Judecătorii' },
  { value: 'JudecatoriaSTREHAIA', label: 'Judecătoria Strehaia', group: 'Judecătorii' },
  { value: 'JudecatoriaSUCEAVA', label: 'Judecătoria Suceava', group: 'Judecătorii' },
  { value: 'JudecatoriaTARGOVISTE', label: 'Judecătoria Târgoviște', group: 'Judecătorii' },
  { value: 'JudecatoriaTARGUBUJOR', label: 'Judecătoria Târgu Bujor', group: 'Judecătorii' },
  { value: 'JudecatoriaTARGUCARBUNESTI', label: 'Judecătoria Târgu Cărbunești', group: 'Judecătorii' },
  { value: 'JudecatoriaTARGUJIU', label: 'Judecătoria Târgu Jiu', group: 'Judecătorii' },
  { value: 'JudecatoriaTARGULAPUS', label: 'Judecătoria Târgu Lăpuș', group: 'Judecătorii' },
  { value: 'JudecatoriaTARGUMURES', label: 'Judecătoria Târgu Mureș', group: 'Judecătorii' },
  { value: 'JudecatoriaTARGUNEAMT', label: 'Judecătoria Târgu Neamț', group: 'Judecătorii' },
  { value: 'JudecatoriaTARGUSECUIESC', label: 'Judecătoria Târgu Secuiesc', group: 'Judecătorii' },
  { value: 'JudecatoriaTARNAVENI', label: 'Judecătoria Târnăveni', group: 'Judecătorii' },
  { value: 'JudecatoriaTECUCI', label: 'Judecătoria Tecuci', group: 'Judecătorii' },
  { value: 'JudecatoriaTIMISOARA', label: 'Judecătoria Timișoara', group: 'Judecătorii' },
  { value: 'JudecatoriaTOPLITA', label: 'Judecătoria Toplița', group: 'Judecătorii' },
  { value: 'JudecatoriaTOPOLOVENI', label: 'Judecătoria Topoloveni', group: 'Judecătorii' },
  { value: 'JudecatoriaTULCEA', label: 'Judecătoria Tulcea', group: 'Judecătorii' },
  { value: 'JudecatoriaTURDA', label: 'Judecătoria Turda', group: 'Judecătorii' },
  { value: 'JudecatoriaTURNUMAGURELE', label: 'Judecătoria Turnu Măgurele', group: 'Judecătorii' },
  { value: 'JudecatoriaURZICENI', label: 'Judecătoria Urziceni', group: 'Judecătorii' },
  { value: 'JudecatoriaVALENIIDEMUNTE', label: 'Judecătoria Vălenii de Munte', group: 'Judecătorii' },
  { value: 'JudecatoriaVANJUMARE', label: 'Judecătoria Vânju Mare', group: 'Judecătorii' },
  { value: 'JudecatoriaVASLUI', label: 'Judecătoria Vaslui', group: 'Judecătorii' },
  { value: 'JudecatoriaVATRADORNEI', label: 'Judecătoria Vatra Dornei', group: 'Judecătorii' },
  { value: 'JudecatoriaVIDELE', label: 'Judecătoria Videle', group: 'Judecătorii' },
  { value: 'JudecatoriaVISEUDESUS', label: 'Judecătoria Vișeu de Sus', group: 'Judecătorii' },
  { value: 'JudecatoriaZALAU', label: 'Judecătoria Zalău', group: 'Judecătorii' },
  { value: 'JudecatoriaZARNESTI', label: 'Judecătoria Zărnești', group: 'Judecătorii' },
  { value: 'JudecatoriaZIMNICEA', label: 'Judecătoria Zimnicea', group: 'Judecătorii' },
];

// Normalize raw SOAP institution names to proper labels
// SOAP returns e.g. "Tribunalul SATUMARE" → should be "Tribunalul Satu Mare"
const _normalizeCache = new Map<string, string>();

function _stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function _buildKey(s: string): string {
  return _stripDiacritics(s).replace(/\s+/g, "").toLowerCase();
}

// Build lookup on first use
let _lookupBuilt = false;
function _ensureLookup() {
  if (_lookupBuilt) return;
  for (const inst of INSTITUTII) {
    _normalizeCache.set(_buildKey(inst.label), inst.label);
    _normalizeCache.set(_buildKey(inst.value), inst.label);
  }
  _lookupBuilt = true;
}

export function normalizeInstitutie(raw: string): string {
  if (!raw) return raw;
  _ensureLookup();
  return _normalizeCache.get(_buildKey(raw)) ?? raw;
}

import { DictionaryService } from '../../dictionary/dictionary.service';
import { DictionaryType } from '@prisma/client';

export interface SchemaField<T = any> {
  type: 'dictionary' | 'number' | 'string' | 'boolean';
  dictionaryType?: DictionaryType;
  default?: any;
  get: (obj: T) => any;
  set: (obj: T, val: any) => void;
}

export const CHARACTER_SCHEMA: SchemaField[] = [
  { 
    type: 'dictionary', 
    dictionaryType: DictionaryType.CHARACTER,
    get: c => c.key, 
    set: (c, v) => c.key = v 
  },
  { type: 'number', default: 1, get: c => c.level, set: (c, v) => c.level = v },
  { type: 'number', default: 0, get: c => c.ascension, set: (c, v) => c.ascension = v },
  { type: 'number', default: 0, get: c => c.constellation, set: (c, v) => c.constellation = v },
  { type: 'number', default: 1, get: c => c.talent?.auto, set: (c, v) => { c.talent = c.talent || {}; c.talent.auto = v; } },
  { type: 'number', default: 1, get: c => c.talent?.skill, set: (c, v) => { c.talent = c.talent || {}; c.talent.skill = v; } },
  { type: 'number', default: 1, get: c => c.talent?.burst, set: (c, v) => { c.talent = c.talent || {}; c.talent.burst = v; } },
];

export const WEAPON_SCHEMA: SchemaField[] = [
  { 
    type: 'dictionary', 
    dictionaryType: DictionaryType.WEAPON,
    get: w => w.key, 
    set: (w, v) => w.key = v 
  },
  { type: 'number', default: 1, get: w => w.level, set: (w, v) => w.level = v },
  { type: 'number', default: 0, get: w => w.ascension, set: (w, v) => w.ascension = v },
  { type: 'number', default: 1, get: w => w.refinement, set: (w, v) => w.refinement = v },
  { 
    type: 'dictionary', 
    dictionaryType: DictionaryType.CHARACTER,
    default: '',
    get: w => w.location || '', 
    set: (w, v) => w.location = v 
  },
  { type: 'boolean', default: false, get: w => w.lock, set: (w, v) => w.lock = v },
];

export class DataPacker {
  constructor(private dictionaryService: DictionaryService) {}

  /**
   * Pre-resolves all dictionary keys to ensure they are cached before packing.
   */
  async preResolve(schema: SchemaField[], items: any[]) {
    const requests: { type: DictionaryType; rawKey: string }[] = [];
    for (const item of items) {
      for (const field of schema) {
        if (field.type === 'dictionary' && field.dictionaryType) {
          const val = field.get(item);
          if (val) {
            requests.push({ type: field.dictionaryType, rawKey: val });
          }
        }
      }
    }
    await this.dictionaryService.getIdsBulk(requests);
  }

  pack(schema: SchemaField[], item: any): any[] {
    return schema.map(field => {
      let val = field.get(item);
      if (val === undefined || val === null) {
        val = field.default;
      }
      
      if (field.type === 'dictionary' && field.dictionaryType) {
        if (val) {
          return this.dictionaryService.getIdSync(field.dictionaryType, val);
        }
        return 0; // 0 for empty location etc.
      }
      
      if (field.type === 'boolean') {
        return val ? 1 : 0;
      }
      
      return val;
    });
  }

  unpack(schema: SchemaField[], arr: any[]): any {
    const obj: any = {};
    for (let i = 0; i < schema.length; i++) {
      const field = schema[i];
      let rawVal = arr[i];
      
      if (rawVal === undefined || rawVal === null) {
        rawVal = field.default;
      }

      if (field.type === 'dictionary') {
        if (rawVal && typeof rawVal === 'number') {
          const key = this.dictionaryService.getKey(rawVal);
          field.set(obj, key || field.default || '');
        } else {
          field.set(obj, field.default || '');
        }
      } else if (field.type === 'boolean') {
        field.set(obj, rawVal === 1);
      } else {
        field.set(obj, rawVal);
      }
    }
    return obj;
  }
}

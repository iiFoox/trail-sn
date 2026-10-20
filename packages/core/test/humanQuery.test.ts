import { it, expect } from 'vitest';
import { humanQuery } from '../src/util';
it('h', () => { expect(humanQuery('short_description=X^descriptionVALCHANGES^EQ')).toBe('short_description = X e description muda'); expect(humanQuery('category=a^ORcategory=b^active=true')).toBe('category = a ou category = b e active = true'); });

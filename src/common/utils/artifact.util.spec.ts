import {
  ArtifactMutableState,
  mergeArtifactMutableState,
} from './artifact.util';

/**
 * The collapse of two stat-identical artifacts onto their single shared row has
 * to be a function of the *set* of duplicates, never of the order they happened
 * to appear in the uploaded file - that order comes from a Rust `HashMap` and
 * changes between runs. Commutativity is therefore the contract, not a detail.
 */
describe('mergeArtifactMutableState', () => {
  const locations = ['', 'Amber', 'Klee'];
  const bools = [false, true];

  const everyState = (): ArtifactMutableState[] => {
    const out: ArtifactMutableState[] = [];
    for (const location of locations) {
      for (const lock of bools) {
        for (const astralMark of bools) {
          out.push({ location, lock, astralMark });
        }
      }
    }
    return out;
  };

  it('is commutative for every combination of states', () => {
    for (const a of everyState()) {
      for (const b of everyState()) {
        expect(mergeArtifactMutableState(a, b)).toEqual(
          mergeArtifactMutableState(b, a),
        );
      }
    }
  });

  it('is associative, so three or more duplicates also collapse stably', () => {
    const states = everyState();
    for (const a of states) {
      for (const b of states) {
        for (const c of states) {
          expect(
            mergeArtifactMutableState(mergeArtifactMutableState(a, b), c),
          ).toEqual(
            mergeArtifactMutableState(a, mergeArtifactMutableState(b, c)),
          );
        }
      }
    }
  });

  it('is idempotent: merging a state with itself changes nothing', () => {
    for (const a of everyState()) {
      expect(mergeArtifactMutableState(a, a)).toEqual(a);
    }
  });

  it('ORs the booleans - one locked copy locks the shared row', () => {
    expect(
      mergeArtifactMutableState(
        { location: '', lock: true, astralMark: false },
        { location: '', lock: false, astralMark: true },
      ),
    ).toEqual({ location: '', lock: true, astralMark: true });
  });

  it('prefers an equipped copy over one sitting in the inventory', () => {
    expect(
      mergeArtifactMutableState(
        { location: '', lock: false, astralMark: false },
        { location: 'Amber', lock: false, astralMark: false },
      ).location,
    ).toBe('Amber');
  });

  it('settles two different holders lexicographically', () => {
    expect(
      mergeArtifactMutableState(
        { location: 'Klee', lock: false, astralMark: false },
        { location: 'Amber', lock: false, astralMark: false },
      ).location,
    ).toBe('Amber');
  });
});

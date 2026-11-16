// The downloaded vehicles in the world (app/models, built by scripts/models/build_vehicles.mjs):
// the wrecked cars, the Ural trucks (covered, open, burnt out), the crashed helicopter.
// All have their length along local +x and their base at y = 0.
import { cloneModel } from './models.js';

/** Half length and half width of each car's footprint, metres (the obstacle the dead walk round). */
export const CAR_SIZE = {
  car_sedan: [2.6, 1.0], car_police: [2.6, 0.95], car_police_flip: [2.6, 1.0], car_hatch: [2.15, 0.9], car_saloon: [2.25, 0.95],
};
/** The Ural-4320's half length and half width. */
export const TRUCK_SIZE = [3.7, 1.3];

/**
 * A static model at an object's transform, instanced with the others like it once the
 * models are in (Environment.addModel). obj: any Object3D placed as the model should be.
 */
export function placeModel(env, name, obj, opts) {
  obj.updateMatrix();
  env.addModel(name, obj.matrix, opts);
  return obj;
}

/**
 * A Ural of its own, for one that moves or comes and goes: covered with its canvas,
 * open (the canvas node hidden) or the burnt-out wreck (never covered).
 */
export function makeUral({ burnt = false, covered = true } = {}) {
  const g = cloneModel(burnt ? 'ural_burnt' : 'ural');
  if (!covered && !burnt) g.getObjectByName('canvas').visible = false;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
/** On the Ural's bed (open): its centre along x, the floor's height, its length. */
export const URAL_BED = { x: -1.8, y: 1.42, len: 3.7 };
/** Headlights: forward along +x, either side, height. */
export const URAL_LAMPS = { x: 3.6, side: 0.8, y: 1.37 };


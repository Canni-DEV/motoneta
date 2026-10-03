import motocrossRig from './bike-rig.json';
import motonetaRig from './motoneta-rig.json';
import type { VehicleId } from './appearance';

export interface WheelDimensions { rearX: number; frontX: number; axleY: number; radius: number }
export type RigDefinition = typeof motocrossRig;
export interface VehicleVisual {
  dimensions: WheelDimensions;
  rig: RigDefinition;
  steering: readonly [number, number, number];
  suspension: {
    swingPivot: readonly [number, number, number];
    shock: readonly [readonly [number, number, number], readonly [number, number, number]];
    spring: readonly [readonly [number, number, number], readonly [number, number, number]];
  };
  exhaust: readonly [number, number, number];
  engine: readonly [number, number, number];
  crashEnvelope: readonly (readonly [number, number, number, number])[];
}
const motocross: VehicleVisual = {
  dimensions: { rearX: -.53, frontX: .57, axleY: .29, radius: .306 }, rig: motocrossRig,
  steering: [.324, .89, 0], exhaust: [-.649, .731, -.174], engine: [.06, .54, 0],
  suspension: { swingPivot: [-.1,.407,0], shock: [[-.32,.342,0],[-.245,.699,0]], spring: [[-.3,.432,0],[-.256,.639,0]] },
  crashEnvelope: [[-.76,.75,-.12,0],[.81,.65,.12,0],[.06,.4,-.19,0],[.32,.95,.2,0]],
};
const motoneta: VehicleVisual = {
  dimensions: { rearX: -.53, frontX: .57, axleY: .22, radius: .22 }, rig: motonetaRig,
  steering: [.324, .94, 0], exhaust: [-.745,.33,-.19], engine: [-.42,.385,0],
  suspension: { swingPivot: [-.26,.35,0], shock: [[-.51,.27,0],[-.4,.61,0]], spring: [[-.482,.355,0],[-.42,.548,0]] },
  crashEnvelope: [[-.78,.65,-.218,0],[.785,.45,.124,0],[-.005,.264,-.25,0],[.33,1.137,.286,0]],
};
export const VEHICLE_VISUALS: Record<VehicleId, VehicleVisual> = { motocross, motoneta };

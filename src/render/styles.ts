import { Color } from 'three';

export type StyleId = 'pencil' | 'charcoal' | 'blueprint';

export interface SketchStyle {
  id: StyleId;
  label: string;
  paper: string;
  ink: string;
  hatch: string;
  /** Edge line half-width in CSS pixels. */
  lineWidth: number;
  lineStrength: number;
  hatchScale: number;
  hatchStrength: number;
  /** Extra flat tonal shading (charcoal smudge). */
  smudge: number;
  grain: number;
  vignette: number;
  /** Draw a faint drafting grid (blueprint). */
  grid: number;
  /** UI theme for the surrounding chrome. */
  ui: 'paper' | 'dark' | 'blueprint';
}

export const STYLES: Record<StyleId, SketchStyle> = {
  pencil: {
    id: 'pencil',
    label: 'Pencil',
    paper: '#f3eee3',
    ink: '#2a2a2c',
    hatch: '#3a3a3e',
    lineWidth: 1,
    lineStrength: 0.85,
    hatchScale: 1,
    hatchStrength: 0.5,
    smudge: 0,
    grain: 0.4,
    vignette: 0.22,
    grid: 0,
    ui: 'paper',
  },
  charcoal: {
    id: 'charcoal',
    label: 'Charcoal',
    paper: '#e9e4d8',
    ink: '#121212',
    hatch: '#1c1c1c',
    lineWidth: 1.8,
    lineStrength: 1,
    hatchScale: 1.7,
    hatchStrength: 0.62,
    smudge: 0.18,
    grain: 0.8,
    vignette: 0.4,
    grid: 0,
    ui: 'dark',
  },
  blueprint: {
    id: 'blueprint',
    label: 'Blueprint',
    paper: '#1d4f8f',
    ink: '#eef5ff',
    hatch: '#cfe2ff',
    lineWidth: 0.9,
    lineStrength: 0.95,
    hatchScale: 0.9,
    hatchStrength: 0.35,
    smudge: 0,
    grain: 0.2,
    vignette: 0.3,
    grid: 1,
    ui: 'blueprint',
  },
};

export const toColor = (hex: string) => new Color(hex);

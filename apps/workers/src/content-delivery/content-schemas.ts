import { z } from 'zod';

/**
 * Content Execution Layer output schemas (CEL Spec V1.1 §7).
 * One discriminated union over `format`: a piece is a REEL or a CAROUSEL.
 * Bounds (D2): reels carry 3–6 talking points; carousels carry 5–10 slides.
 */

export const ReelOutputSchema = z.object({
  piece_id:          z.enum(['R1', 'R2', 'R3']),
  format:            z.literal('REEL'),
  hook:              z.string().min(1),
  script:            z.string().min(1),
  talking_points:    z.array(z.string().min(1)).min(3).max(6),
  caption:           z.string().min(1),
  cta:               z.string().nullable(),
  belief_target_ref: z.string().min(1),
});

export const CarouselSlideSchema = z.object({
  slide_number: z.number().int().positive(),
  role:         z.string().min(1),
  copy:         z.string().min(1),
});

export const CarouselOutputSchema = z.object({
  piece_id:          z.enum(['C1', 'C2']),
  format:            z.literal('CAROUSEL'),
  slides:            z.array(CarouselSlideSchema).min(5).max(10),
  caption:           z.string().min(1),
  cta:               z.string().nullable(),
  belief_target_ref: z.string().min(1),
});

export const ContentPieceOutputSchema = z.discriminatedUnion('format', [
  ReelOutputSchema,
  CarouselOutputSchema,
]);

export type ReelOutput = z.infer<typeof ReelOutputSchema>;
export type CarouselOutput = z.infer<typeof CarouselOutputSchema>;
export type ContentPieceOutput = z.infer<typeof ContentPieceOutputSchema>;

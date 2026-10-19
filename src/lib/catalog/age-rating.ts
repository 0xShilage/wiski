/** Classificação indicativa (ClassInd) — official labels and colours (design §2). */
export const AGE_RATINGS = ['L', 'A10', 'A12', 'A14', 'A16', 'A18'] as const;
export type AgeRatingCode = (typeof AGE_RATINGS)[number];

export const AGE_LABEL: Record<AgeRatingCode, string> = {
  L: 'L',
  A10: '10',
  A12: '12',
  A14: '14',
  A16: '16',
  A18: '18',
};

export const AGE_DESCRIPTION: Record<AgeRatingCode, string> = {
  L: 'Livre para todos os públicos',
  A10: 'Não recomendado para menores de 10 anos',
  A12: 'Não recomendado para menores de 12 anos',
  A14: 'Não recomendado para menores de 14 anos',
  A16: 'Não recomendado para menores de 16 anos',
  A18: 'Não recomendado para menores de 18 anos',
};

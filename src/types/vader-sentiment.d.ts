declare module "vader-sentiment" {
  interface SentimentScores {
    neg: number;
    neu: number;
    pos: number;
    compound: number;
  }

  // Ambient declaration mirrors the real library's class shape
  // (static-only analyzer); renaming to an object literal would make the
  // declaration lie about the module it describes.
  // biome-ignore lint/complexity/noStaticOnlyClass: third-party API shape
  class SentimentIntensityAnalyzer {
    static polarity_scores(text: string): SentimentScores;
  }

  const vader: {
    SentimentIntensityAnalyzer: typeof SentimentIntensityAnalyzer;
  };
  export default vader;
}

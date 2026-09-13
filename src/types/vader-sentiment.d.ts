declare module "vader-sentiment" {
  interface SentimentScores {
    neg: number;
    neu: number;
    pos: number;
    compound: number;
  }

  class SentimentIntensityAnalyzer {
    static polarity_scores(text: string): SentimentScores;
  }

  const vader: {
    SentimentIntensityAnalyzer: typeof SentimentIntensityAnalyzer;
  };
  export default vader;
}

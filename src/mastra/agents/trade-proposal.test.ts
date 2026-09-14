import { describe, expect, it } from "bun:test";

import { parseTradeProposal } from "./trade-proposal";

describe("parseTradeProposal", () => {
  it("accepts a complete JSON proposal", () => {
    expect(
      parseTradeProposal(
        '{"direction":"LONG","confidence":0.82,"reasoning":"Momentum and sentiment agree."}',
      ),
    ).toEqual({
      confidence: 0.82,
      direction: "LONG",
      reasoning: "Momentum and sentiment agree.",
    });
  });

  it("accepts a JSON code fence without relaxing the schema", () => {
    expect(
      parseTradeProposal(
        '```json\n{"direction":"SHORT","confidence":0.7,"reasoning":"Resistance held."}\n```',
      ),
    ).toEqual({
      confidence: 0.7,
      direction: "SHORT",
      reasoning: "Resistance held.",
    });
  });

  it("rejects abstentions, coercible values, and incomplete output", () => {
    expect(
      parseTradeProposal(
        '{"direction":"ABSTAIN","confidence":0.8,"reasoning":"No trade."}',
      ),
    ).toBeNull();
    expect(
      parseTradeProposal(
        '{"direction":"LONG","confidence":"0.8","reasoning":"String confidence."}',
      ),
    ).toBeNull();
    expect(
      parseTradeProposal('{"direction":"LONG","confidence":0.8}'),
    ).toBeNull();
    expect(parseTradeProposal("not JSON")).toBeNull();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  isExternalFetchEnabled,
  isMopsFetchEnabled,
} from "../src/config.js";

const originalExternalValue = process.env.ENABLE_EXTERNAL_FETCH;
const originalMopsValue = process.env.ENABLE_MOPS_FETCH;

afterEach(() => {
  if (originalExternalValue === undefined) {
    delete process.env.ENABLE_EXTERNAL_FETCH;
  } else {
    process.env.ENABLE_EXTERNAL_FETCH = originalExternalValue;
  }
  if (originalMopsValue === undefined) {
    delete process.env.ENABLE_MOPS_FETCH;
  } else {
    process.env.ENABLE_MOPS_FETCH = originalMopsValue;
  }
});

describe("external source authorization gates", () => {
  it("缺少明確同意時預設停用", () => {
    delete process.env.ENABLE_EXTERNAL_FETCH;
    delete process.env.ENABLE_MOPS_FETCH;
    expect(isExternalFetchEnabled()).toBe(false);
    expect(isMopsFetchEnabled()).toBe(false);
  });

  it("只有明確的 true 才啟用", () => {
    process.env.ENABLE_EXTERNAL_FETCH = "true";
    process.env.ENABLE_MOPS_FETCH = "true";
    expect(isExternalFetchEnabled()).toBe(true);
    expect(isMopsFetchEnabled()).toBe(true);
  });
});

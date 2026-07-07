import { describe, expect, it } from "vitest";

import {
  classifyRequestSiteRelationship,
  formatUrlHost,
} from "./domains";

describe("classifyRequestSiteRelationship", () => {
  it("classifies identical hosts as same-site", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "https://example.com/page",
        requestUrl: "https://example.com/app.js",
      }),
    ).toMatchObject({
      status: "same-site",
      pageHost: "example.com",
      pageSite: "example.com",
      requestHost: "example.com",
      requestSite: "example.com",
    });
  });

  it("classifies subdomains under the same registrable domain as same-site", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "https://www.example.com",
        requestUrl: "https://static.example.com/app.js",
      }),
    ).toMatchObject({
      status: "same-site",
      pageSite: "example.com",
      requestSite: "example.com",
    });
  });

  it("classifies different registrable domains as third-party", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "https://example.com",
        requestUrl: "https://tracker.test/script.js",
      }),
    ).toMatchObject({
      status: "third-party",
      pageSite: "example.com",
      requestSite: "tracker.test",
    });
  });

  it("uses public suffix parsing for same-site country-code domains", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "https://shop.example.co.uk",
        requestUrl: "https://cdn.example.co.uk/image.png",
      }),
    ).toMatchObject({
      status: "same-site",
      pageSite: "example.co.uk",
      requestSite: "example.co.uk",
    });
  });

  it("uses public suffix parsing for cross-site country-code domains", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "https://example.co.uk",
        requestUrl: "https://other.co.uk/script.js",
      }),
    ).toMatchObject({
      status: "third-party",
      pageSite: "example.co.uk",
      requestSite: "other.co.uk",
    });
  });

  it("uses private suffix parsing for multi-tenant domains", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "https://alice.github.io",
        requestUrl: "https://bob.github.io/script.js",
      }),
    ).toMatchObject({
      status: "third-party",
      pageSite: "alice.github.io",
      requestSite: "bob.github.io",
    });
  });

  it("classifies matching IP literals as same-site", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "http://127.0.0.1/page",
        requestUrl: "http://127.0.0.1/script.js",
      }),
    ).toMatchObject({
      status: "same-site",
      pageSite: "127.0.0.1",
      requestSite: "127.0.0.1",
    });
  });

  it("classifies different IP literals as third-party", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "http://127.0.0.1/page",
        requestUrl: "http://192.168.0.1/script.js",
      }),
    ).toMatchObject({
      status: "third-party",
      pageSite: "127.0.0.1",
      requestSite: "192.168.0.1",
    });
  });

  it("classifies matching IPv6 literals as same-site", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "http://[::1]/page",
        requestUrl: "http://[::1]/script.js",
      }),
    ).toMatchObject({
      status: "same-site",
      pageSite: "::1",
      requestSite: "::1",
    });
  });

  it("classifies bare localhost by exact host match", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "http://localhost:3000/page",
        requestUrl: "http://localhost:5173/script.js",
      }),
    ).toMatchObject({
      status: "same-site",
      pageSite: "localhost",
      requestSite: "localhost",
    });

    expect(
      classifyRequestSiteRelationship({
        pageUrl: "http://localhost:3000/page",
        requestUrl: "http://api.localhost/script.js",
      }),
    ).toMatchObject({
      status: "third-party",
      pageSite: "localhost",
      requestSite: "api.localhost",
    });
  });

  it("normalizes case and trailing dots", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "https://Example.COM./page",
        requestUrl: "https://cdn.example.com./script.js",
      }),
    ).toMatchObject({
      status: "same-site",
      pageHost: "example.com",
      requestHost: "cdn.example.com",
    });
  });

  it("returns unclassifiable for missing inputs", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: undefined,
        requestUrl: "https://example.com/script.js",
      }),
    ).toEqual({
      status: "unclassifiable",
      reason: "missing-url",
      inputRole: "page",
    });

    expect(
      classifyRequestSiteRelationship({
        pageUrl: "https://example.com",
        requestUrl: "",
      }),
    ).toEqual({
      status: "unclassifiable",
      reason: "missing-url",
      inputRole: "request",
    });
  });

  it("returns unclassifiable for malformed inputs", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "not a url",
        requestUrl: "https://example.com/script.js",
      }),
    ).toEqual({
      status: "unclassifiable",
      reason: "malformed-url",
      inputRole: "page",
    });

    expect(
      classifyRequestSiteRelationship({
        pageUrl: "https://example.com",
        requestUrl: "https://[not-ipv6]/script.js",
      }),
    ).toEqual({
      status: "unclassifiable",
      reason: "malformed-url",
      inputRole: "request",
    });
  });

  it("ignores non-web page schemes", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "moz-extension://extension-id/popup.html",
        requestUrl: "https://example.com/script.js",
      }),
    ).toEqual({
      status: "ignored",
      reason: "non-web-scheme",
      inputRole: "page",
      scheme: "moz-extension",
    });
  });

  it("ignores non-web request schemes", () => {
    for (const requestUrl of [
      "about:blank",
      "browser://settings",
      "chrome://settings",
      "data:text/plain,hello",
      "file:///tmp/example.txt",
      "moz-extension://extension-id/content.js",
    ]) {
      expect(
        classifyRequestSiteRelationship({
          pageUrl: "https://example.com",
          requestUrl,
        }),
      ).toMatchObject({
        status: "ignored",
        reason: "non-web-scheme",
        inputRole: "request",
      });
    }
  });

  it("returns unclassifiable for hostless web URLs", () => {
    expect(
      classifyRequestSiteRelationship({
        pageUrl: "https://example.com",
        requestUrl: "https:///script.js",
      }),
    ).toEqual({
      status: "unclassifiable",
      reason: "missing-host",
      inputRole: "request",
    });
  });
});

describe("formatUrlHost", () => {
  it("formats normalized hosts for web URLs", () => {
    expect(formatUrlHost("https://Example.COM./page")).toBe("example.com");
  });

  it("returns null for missing, malformed, or non-web URLs", () => {
    expect(formatUrlHost()).toBeNull();
    expect(formatUrlHost("not a url")).toBeNull();
    expect(formatUrlHost("about:blank")).toBeNull();
  });
});

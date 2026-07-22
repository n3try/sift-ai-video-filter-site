const UNSUPPORTED_CONFORMANCE_CLAIM = /\b(?:ADA[\s-]+compliant|meets?\s+(?:the\s+)?ADA\s+requirements?|WCAG\s*2\.[012]\s*(?:Level\s*)?(?:A{1,3}\s*)?(?:compliant|conformant)|fully\s+accessible)\b/i;

export function hasUnsupportedConformanceClaim(source) {
  return UNSUPPORTED_CONFORMANCE_CLAIM.test(source);
}

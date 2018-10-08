bool outOfRange(float a, float b, float p) {
  if (p > max(a, b)) return true;
  if (p < min(a, b)) return true;
  return false;
}

#pragma glslify: export(outOfRange)
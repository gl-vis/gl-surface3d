precision highp float;

uniform vec3 lowerBound;
uniform vec3 upperBound;
uniform sampler2D colormap;

varying float value;

void main() {
  float interpValue = (value - lowerBound.z) / (upperBound.z - lowerBound.z);
  gl_FragColor = texture2D(colormap, vec2(interpValue, interpValue));
}
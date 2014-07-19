precision highp float;

uniform vec3 lowerBound;
uniform vec3 upperBound;
uniform sampler2D colormap;
uniform vec3 clipBounds[2];

varying float value;
varying vec3 worldCoordinate;

void main() {
  if(any(lessThan(worldCoordinate, clipBounds[0])) || any(greaterThan(worldCoordinate, clipBounds[1]))) {
    discard;
  }
  float interpValue = (value - lowerBound.z) / (upperBound.z - lowerBound.z);
  gl_FragColor = texture2D(colormap, vec2(interpValue, interpValue));
}
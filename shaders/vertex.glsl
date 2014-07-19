attribute vec2 uv;
attribute float f;

uniform mat4 model;
uniform mat4 view;
uniform mat4 projection;

varying float value;
varying vec3 worldCoordinate;
varying vec2 planeCoordinate;

void main() {
  vec4 worldPosition = model * vec4(uv, f, 1.0);
  gl_Position = projection * view * worldPosition;
  value = f;
  worldCoordinate = worldPosition.xyz / worldPosition.w;
  planeCoordinate = uv;
}
precision mediump float;

attribute vec4 uv;

uniform mat4 model, view, projection;
uniform float height, zOffset;

varying float value;
varying float kill;
varying vec3 worldCoordinate;
varying vec2 planeCoordinate;

void main() {
  vec4 worldPosition = model * vec4(uv.xy, height, 1.0);

  vec4 clipPosition = projection * view * worldPosition;
  clipPosition.z = clipPosition.z + zOffset;

  gl_Position = clipPosition;
  value = height;
  kill = -1.0;
  worldCoordinate = vec3(uv.xy, height);
  planeCoordinate = uv.zw;
}
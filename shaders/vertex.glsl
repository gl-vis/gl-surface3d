precision mediump float;

attribute vec4 uv;
attribute vec2 f;

uniform mat4 model;
uniform mat4 view;
uniform mat4 projection;

varying float value;
varying float kill;
varying vec3 worldCoordinate;
varying vec2 planeCoordinate;

void main() {
  vec4 worldPosition = model * vec4(uv.zw, f.x, 1.0);
  gl_Position = projection * view * worldPosition;
  value = f.x;
  kill = f.y;
  worldCoordinate = vec3(uv.zw, f.x);
  planeCoordinate = uv.xy;
}
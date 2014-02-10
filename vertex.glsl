attribute vec2 uv;
attribute float f;

uniform mat4 model;
uniform mat4 view;
uniform mat4 projection;

varying float value;

void main() {
  gl_Position = projection * view * model * vec4(uv, f, 1.0);
  value = f;
}
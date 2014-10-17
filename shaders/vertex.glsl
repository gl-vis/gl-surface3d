precision mediump float;

attribute vec4 uv;
attribute vec2 f;
attribute vec3 normal;

uniform mat4 model, view, projection;
uniform vec3 lightPosition, eyePosition;

varying float value, kill;
varying vec3 worldCoordinate;
varying vec2 planeCoordinate;
varying vec3 lightDirection, eyeDirection, surfaceNormal;

void main() {
  vec4 worldPosition = model * vec4(uv.zw, f.x, 1.0);
  gl_Position = projection * view * worldPosition;
  value = f.x;
  kill = f.y;
  worldCoordinate = vec3(uv.zw, f.x);
  planeCoordinate = uv.xy;
  
  //Lighting geometry parameters
  lightDirection = lightPosition - worldCoordinate;
  eyeDirection   = eyePosition - worldCoordinate;
  surfaceNormal = normal;
  if(dot(eyeDirection, normal) < 0.0) {
    surfaceNormal = -normal;
  }
}
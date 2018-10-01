precision mediump float;

#pragma glslify: beckmann = require(glsl-specular-beckmann)

uniform vec3 lowerBound, upperBound;
uniform float contourTint;
uniform vec4 contourColor;
uniform sampler2D colormap;
uniform vec3 clipBounds[2];
uniform float roughness, fresnel, kambient, kdiffuse, kspecular, opacity;
uniform float vertexColor;

varying float value, kill;
varying vec3 worldCoordinate;
varying vec3 lightDirection, eyeDirection, surfaceNormal;
varying vec4 vColor;

bool outOfRange(float a, float b, float p) {
  if (p > max(a, b)) return true;
  if (p < min(a, b)) return true;
  return false;
}

void main() {
  if (kill > 0.0) discard;
  if (outOfRange(clipBounds[0].x, clipBounds[1].x, worldCoordinate.x)) discard;
  if (outOfRange(clipBounds[0].y, clipBounds[1].y, worldCoordinate.y)) discard;
  if (outOfRange(clipBounds[0].z, clipBounds[1].z, worldCoordinate.z)) discard;

  vec3 N = normalize(surfaceNormal);
  vec3 V = normalize(eyeDirection);
  vec3 L = normalize(lightDirection);

  if(gl_FrontFacing) {
    N = -N;
  }

  float specular = max(beckmann(L, V, N, roughness), 0.);
  float diffuse  = min(kambient + kdiffuse * max(dot(N, L), 0.0), 1.0);

  //decide how to interpolate color — in vertex or in fragment
  vec4 surfaceColor = step(vertexColor, .5) * texture2D(colormap, vec2(value, value)) + step(.5, vertexColor) * vColor;

  vec4 litColor = surfaceColor.a * vec4(diffuse * surfaceColor.rgb + kspecular * vec3(1,1,1) * specular,  1.0);

  gl_FragColor = mix(litColor, contourColor, contourTint) * opacity;
}

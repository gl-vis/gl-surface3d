'use strict'

var dup = require('dup')

// based on https://github.com/scijs/ndarray-gradient
module.exports = function gradient(out, inp, bc) {
  if(Array.isArray(bc)) {
    if(bc.length !== inp.dimension) {
      throw new Error('ndarray-gradient: invalid boundary conditions')
    }
  } else if(typeof bc === 'string') {
    bc = dup(inp.dimension, bc)
  } else {
    bc = dup(inp.dimension, 'clamp')
  }
  if(out.dimension !== inp.dimension + 1) {
    throw new Error('ndarray-gradient: output dimension must be +1 input dimension')
  }
  if(out.shape[inp.dimension] !== inp.dimension) {
    throw new Error('ndarray-gradient: output shape must match input shape')
  }
  for(var i=0; i<inp.dimension; ++i) {
    if(out.shape[i] !== inp.shape[i]) {
      throw new Error('ndarray-gradient: shape mismatch')
    }
  }
  if(inp.size === 0) {
    return out
  }
  if(inp.dimension <= 0) {
    out.set(0)
    return out
  }
  return cached(out, inp)
}

function cached(diff, zero, grad1, grad2) {
  function gradient(dst, src) {
    var s = src.shape.slice()
    if (1 && s[0] > 2 && s[1] > 2) {
      grad2(
        src
          .pick(-1, -1)
          .lo(1, 1)
          .hi(s[0] - 2, s[1] - 2),
        dst
          .pick(-1, -1, 0)
          .lo(1, 1)
          .hi(s[0] - 2, s[1] - 2),
        dst
          .pick(-1, -1, 1)
          .lo(1, 1)
          .hi(s[0] - 2, s[1] - 2)
      )
    }
    if (1 && s[1] > 2) {
      grad1(
        src
          .pick(0, -1)
          .lo(1)
          .hi(s[1] - 2),
        dst
          .pick(0, -1, 1)
          .lo(1)
          .hi(s[1] - 2)
      )
      zero(
        dst
          .pick(0, -1, 0)
          .lo(1)
          .hi(s[1] - 2)
      )
    }
    if (1 && s[1] > 2) {
      grad1(
        src
          .pick(s[0] - 1, -1)
          .lo(1)
          .hi(s[1] - 2),
        dst
          .pick(s[0] - 1, -1, 1)
          .lo(1)
          .hi(s[1] - 2)
      )
      zero(
        dst
          .pick(s[0] - 1, -1, 0)
          .lo(1)
          .hi(s[1] - 2)
      )
    }
    if (1 && s[0] > 2) {
      grad1(
        src
          .pick(-1, 0)
          .lo(1)
          .hi(s[0] - 2),
        dst
          .pick(-1, 0, 0)
          .lo(1)
          .hi(s[0] - 2)
      )
      zero(
        dst
          .pick(-1, 0, 1)
          .lo(1)
          .hi(s[0] - 2)
      )
    }
    if (1 && s[0] > 2) {
      grad1(
        src
          .pick(-1, s[1] - 1)
          .lo(1)
          .hi(s[0] - 2),
        dst
          .pick(-1, s[1] - 1, 0)
          .lo(1)
          .hi(s[0] - 2)
      )
      zero(
        dst
          .pick(-1, s[1] - 1, 1)
          .lo(1)
          .hi(s[0] - 2)
      )
    }
    dst.set(0, 0, 0, 0)
    dst.set(0, 0, 1, 0)
    dst.set(s[0] - 1, 0, 0, 0)
    dst.set(s[0] - 1, 0, 1, 0)
    dst.set(0, s[1] - 1, 0, 0)
    dst.set(0, s[1] - 1, 1, 0)
    dst.set(s[0] - 1, s[1] - 1, 0, 0)
    dst.set(s[0] - 1, s[1] - 1, 1, 0)
    return dst
  }
  return gradient
}

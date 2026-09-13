import * as THREE from 'three';
import type { MapPoint } from '../td/MapCatalog';

/** Shared, texture-free water: coordinates are metres across / along the flow. */
export function waterMaterial(points: readonly MapPoint[] = []): THREE.ShaderMaterial {
  const falling = points.length === 0;
  return new THREE.ShaderMaterial({
    fog: true,
    side: THREE.DoubleSide,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      time: { value: 0 },
      deep: { value: new THREE.Color('#237d9f') },
      shallow: { value: new THREE.Color('#60c2ce') },
      foam: { value: new THREE.Color('#d7f4ec') },
      ...(falling ? {} : { banks: { value: points.map(([x,z]) => new THREE.Vector2(x,z)) } }),
    },
    vertexShader: `
      attribute vec2 flow;
      varying vec2 vFlow;
      #include <fog_pars_vertex>
      void main() {
        vFlow = flow;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 deep, shallow, foam;
      varying vec2 vFlow;
      #include <fog_pars_fragment>
      ${falling ? '' : `uniform vec2 banks[${points.length}];`}
      void main() {
        // Broad moving colour bands and broken crests stay legible at N64 scale.
        vec2 p = vFlow;
        float travel = p.y - time * ${falling ? '3.6' : '1.25'};
        float bend = sin(p.x * 2.8 + travel * 0.85);
        float wave = sin(travel * 4.5 + bend * 1.4);
        float patches = sin(p.x * 2.1 + travel * 0.7) * sin(travel * 1.7 - p.x);
        vec3 color = mix(deep, shallow, 0.36 + patches * 0.17 + wave * 0.09);
        float crest = smoothstep(0.88, 0.99, wave) * smoothstep(-0.15, 0.65, sin(p.x * 4.2 + travel));
        ${falling ? `
          float streak = pow(0.5 + 0.5 * sin(p.x * 17.0 + sin(travel * 2.0)), 7.0);
          color = mix(color, foam, 0.18 + streak * 0.55 + crest * 0.18);
        ` : `
          float bank = 1000.0;
          for (int i = 0; i < ${points.length}; i++) {
            vec2 a = banks[i];
            vec2 b = banks[${points.length - 1}];
            if (i > 0) b = banks[i - 1];
            vec2 edge = b - a;
            float t = clamp(dot(p - a, edge) / max(dot(edge, edge), 0.0001), 0.0, 1.0);
            bank = min(bank, length(p - a - edge * t));
          }
          float shore = 1.0 - smoothstep(0.0, 0.65, bank);
          color = mix(color, shallow, shore * 0.55);
          float froth = (1.0 - smoothstep(0.03, 0.18, bank)) * (0.35 + 0.2 * sin(travel * 5.0 + p.x * 7.0));
          color = mix(color, foam, crest * 0.42 + froth);
        `}
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

export function animateWater(water: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>): void {
  water.castShadow = false;
  water.onBeforeRender = () => { water.material.uniforms.time.value = performance.now() / 1000; };
}

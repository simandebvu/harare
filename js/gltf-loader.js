// Shared GLTF loader: the models in assets/models are meshopt-compressed (tools/compress-models.sh)
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

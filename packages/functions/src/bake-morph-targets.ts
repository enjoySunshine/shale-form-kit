import {
	Accessor,
	AnimationChannel,
	type Document,
	MathUtils,
	Mesh,
	Node,
	Primitive,
	type PrimitiveTarget,
	PropertyType,
	type Transform,
} from '@gltf-transform/core';
import { createTransform } from './utils.js';

const NAME = 'bakeMorphTargets';

const { FLOAT } = Accessor.ComponentType;

/** Morph target semantics defined by the glTF 2.0 specification. */
const MORPH_SEMANTICS = ['POSITION', 'NORMAL', 'TANGENT'];

/**
 * Bakes the current morph target weights of each {@link Mesh} into its base
 * vertex attributes (`POSITION`, `NORMAL`, and `TANGENT`), then resets the
 * affected {@link PrimitiveTarget} deltas to zero. Weights on the {@link Mesh}
 * and {@link Node} are left unchanged, so the visible state of the mesh is
 * preserved while further morphing starts from the baked state. Applying the
 * transform again has no additional effect.
 *
 * Effective weights are resolved per {@link Node}: weights assigned to the
 * Node override weights assigned to the Mesh, as they do at render time. If
 * the same Mesh is instantiated by Nodes with different effective weights, the
 * Mesh is split so that each distinct set of weights is baked into a separate
 * copy. Nodes whose effective weights are all zero keep the original Mesh,
 * unmodified.
 *
 * Example:
 *
 * ```ts
 * import { bakeMorphTargets } from '@gltf-transform/functions';
 *
 * await document.transform(bakeMorphTargets());
 * ```
 *
 * @category Transforms
 */
export function bakeMorphTargets(): Transform {
	return createTransform(NAME, async (document: Document): Promise<void> => {
		const logger = document.getLogger();
		const root = document.getRoot();

		const animatedNodes = listAnimatedWeightNodes(document);
		const warnedNodes = new Set<Node>();

		for (const mesh of root.listMeshes()) {
			const targetCount = getMeshTargetCount(mesh);
			if (targetCount === 0) continue;

			// Group nodes instantiating this mesh by their effective weights.
			const groups = new Map<string, { weights: number[]; nodes: Node[] }>();
			for (const node of listMeshNodes(mesh)) {
				if (animatedNodes.has(node) && !warnedNodes.has(node)) {
					logger.warn(
						`${NAME}: Weights of node "${node.getName()}" are animated; baking may affect the animation.`,
					);
					warnedNodes.add(node);
				}

				const weights = getEffectiveWeights(node, mesh, targetCount);
				const key = weights.join(',');
				let group = groups.get(key);
				if (!group) groups.set(key, (group = { weights, nodes: [] }));
				group.nodes.push(node);
			}

			const bakeGroups = Array.from(groups.values()).filter((group) =>
				group.weights.some((weight) => weight !== 0),
			);
			if (bakeGroups.length === 0) continue;

			// Nodes with all-zero weights keep the original mesh, unmodified. If
			// no such nodes exist, the first group bakes the mesh in place, and
			// remaining groups receive copies. Copies are created before baking.
			const keepOriginalMesh = groups.size > bakeGroups.length;
			const assignments: [Mesh, number[]][] = [];

			for (const group of bakeGroups) {
				if (!keepOriginalMesh && assignments.length === 0) {
					assignments.push([mesh, group.weights]);
				} else {
					const dstMesh = mesh.clone();
					for (const node of group.nodes) node.setMesh(dstMesh);
					assignments.push([dstMesh, group.weights]);
				}
			}

			for (const [dstMesh, weights] of assignments) {
				bakeMesh(dstMesh, weights);
			}
		}

		logger.debug(`${NAME}: Complete.`);
	});
}

/** Lists nodes instantiating the given {@link Mesh}. */
function listMeshNodes(mesh: Mesh): Node[] {
	return mesh.listParents().filter((parent) => parent instanceof Node) as Node[];
}

/** Returns the number of morph targets used by primitives of the given {@link Mesh}. */
function getMeshTargetCount(mesh: Mesh): number {
	let targetCount = 0;
	for (const prim of mesh.listPrimitives()) {
		targetCount = Math.max(targetCount, prim.listTargets().length);
	}
	return targetCount;
}

/**
 * Returns the effective morph target weights for a {@link Mesh} instantiated
 * by a {@link Node}: weights assigned to the Node override weights assigned
 * to the Mesh, and missing weights default to zero.
 */
function getEffectiveWeights(node: Node, mesh: Mesh, targetCount: number): number[] {
	const nodeWeights = node.getWeights();
	const meshWeights = mesh.getWeights();
	const srcWeights = nodeWeights.length > 0 ? nodeWeights : meshWeights;

	const dstWeights = new Array<number>(targetCount).fill(0);
	for (let i = 0; i < Math.min(srcWeights.length, targetCount); i++) {
		dstWeights[i] = srcWeights[i];
	}
	return dstWeights;
}

/** Lists nodes whose morph target weights are animated. */
function listAnimatedWeightNodes(document: Document): Set<Node> {
	const nodes = new Set<Node>();
	for (const animation of document.getRoot().listAnimations()) {
		for (const channel of animation.listChannels()) {
			const node = channel.getTargetNode();
			if (node && channel.getTargetPath() === AnimationChannel.TargetPath.WEIGHTS) {
				nodes.add(node);
			}
		}
	}
	return nodes;
}

/**
 * Bakes the given morph target weights into every {@link Primitive} of the
 * {@link Mesh}. Primitives, morph targets, and accessors shared with other
 * meshes are detached before modification.
 */
function bakeMesh(mesh: Mesh, weights: number[]): void {
	for (const srcPrim of mesh.listPrimitives()) {
		let prim = srcPrim;

		// Detach primitives shared with other meshes.
		if (srcPrim.listParents().some((parent) => parent instanceof Mesh && parent !== mesh)) {
			prim = srcPrim.clone();
			mesh.removePrimitive(srcPrim).addPrimitive(prim);
		}

		// Detach morph targets shared with other primitives.
		for (const srcTarget of prim.listTargets()) {
			const isSharedTarget = srcTarget
				.listParents()
				.some((parent) => parent instanceof Primitive && parent !== prim);
			if (isSharedTarget) {
				prim.removeTarget(srcTarget).addTarget(srcTarget.clone());
			}
		}

		// Detach vertex attributes shared with other primitives or targets.
		isolateAttributes(prim);
		for (const target of prim.listTargets()) isolateAttributes(target);

		bakePrimitive(prim, weights);
	}
}

/** Clones any vertex attribute of the container shared with other parents. */
function isolateAttributes(container: Primitive | PrimitiveTarget): void {
	for (const semantic of container.listSemantics()) {
		const srcAttribute = container.getAttribute(semantic)!;
		const isShared = srcAttribute
			.listParents()
			.some((parent) => parent !== container && parent.propertyType !== PropertyType.ROOT);
		if (isShared) {
			container.setAttribute(semantic, srcAttribute.clone());
		}
	}
}

/**
 * Bakes the given morph target weights into the base vertex attributes of a
 * {@link Primitive}, then resets the affected {@link PrimitiveTarget} deltas
 * to zero.
 */
function bakePrimitive(prim: Primitive, weights: number[]): void {
	const targets = prim.listTargets();

	for (const semantic of MORPH_SEMANTICS) {
		const baseAttribute = prim.getAttribute(semantic);
		if (!baseAttribute) continue;

		const targetAttributes = targets.map((target) => target.getAttribute(semantic));

		bakeAttribute(baseAttribute, targetAttributes, weights, semantic !== 'POSITION');

		// Reset baked morph target deltas to zero.
		for (const targetAttribute of targetAttributes) {
			if (targetAttribute) targetAttribute.getArray()!.fill(0);
		}
	}
}

/**
 * Adds the weighted morph target deltas to the base attribute, then optionally
 * renormalizes the results (for `NORMAL` and `TANGENT`). Non-float base
 * attributes are converted to float; morph target deltas are left unchanged.
 */
function bakeAttribute(
	baseAttribute: Accessor,
	targetAttributes: (Accessor | null)[],
	weights: number[],
	normalize: boolean,
): void {
	const baseArray = baseAttribute.getArray()!;
	const baseComponentType = baseAttribute.getComponentType();
	const baseNormalized = baseAttribute.getNormalized();
	const elementSize = baseAttribute.getElementSize();
	const vertexCount = baseAttribute.getCount();

	// Morph targets displace only xyz components; TANGENT w is preserved.
	const vectorSize = Math.min(elementSize, 3);

	const isFloat = baseComponentType === FLOAT && !baseNormalized;
	const dstArray: Float32Array<ArrayBuffer> = isFloat
		? (baseArray as Float32Array<ArrayBuffer>)
		: new Float32Array(baseArray.length);

	if (!isFloat) {
		for (let i = 0; i < baseArray.length; i++) {
			dstArray[i] = baseNormalized
				? MathUtils.decodeNormalizedInt(baseArray[i], baseComponentType)
				: baseArray[i];
		}
	}

	for (let targetIndex = 0; targetIndex < targetAttributes.length; targetIndex++) {
		const weight = weights[targetIndex] ?? 0;
		const targetAttribute = targetAttributes[targetIndex];
		if (!weight || !targetAttribute) continue;

		const targetArray = targetAttribute.getArray()!;
		const targetComponentType = targetAttribute.getComponentType();
		const targetNormalized = targetAttribute.getNormalized();
		const targetElementSize = targetAttribute.getElementSize();
		const targetVertexCount = Math.min(vertexCount, targetAttribute.getCount());

		for (let i = 0; i < targetVertexCount; i++) {
			for (let j = 0, jl = Math.min(vectorSize, targetElementSize); j < jl; j++) {
				const value = targetArray[i * targetElementSize + j];
				dstArray[i * elementSize + j] +=
					weight * (targetNormalized ? MathUtils.decodeNormalizedInt(value, targetComponentType) : value);
			}
		}
	}

	if (normalize) {
		for (let i = 0; i < vertexCount; i++) {
			const offset = i * elementSize;
			const x = dstArray[offset];
			const y = dstArray[offset + 1];
			const z = dstArray[offset + 2];
			const length = Math.sqrt(x * x + y * y + z * z);
			if (length > 0) {
				dstArray[offset] = x / length;
				dstArray[offset + 1] = y / length;
				dstArray[offset + 2] = z / length;
			}
		}
	}

	if (!isFloat) {
		baseAttribute.setArray(dstArray).setNormalized(false);
	}
}

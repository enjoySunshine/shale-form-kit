import { deepEqual, notStrictEqual, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Document, type ILogger, type Mesh, type Primitive } from '@gltf-transform/core';
import { bakeMorphTargets } from '@gltf-transform/functions';
import { logger, round } from '@gltf-transform/test-utils';

describe('functions::bakeMorphTargets', () => {
	test('mesh weights', async () => {
		const document = new Document().setLogger(logger);
		const { mesh, prim } = createMorphMesh(document);
		mesh.setWeights([0.5, 0.25]);
		document.createScene().addChild(document.createNode().setMesh(mesh));

		await document.transform(bakeMorphTargets());

		deepEqual(
			Array.from(prim.getAttribute('POSITION')!.getArray()!).map(round(3)),
			// biome-ignore format: Readability.
			[
				0, 0.25, 0.5,
				1, 0, 0.5,
				0, 1, 0.5,
			],
			'bakes positions',
		);
		deepEqual(
			Array.from(prim.getAttribute('NORMAL')!.getArray()!).map(round(3)),
			// biome-ignore format: Readability.
			[
				0, 0.447, 0.894,
				0, 0.447, 0.894,
				0, 0.447, 0.894,
			],
			'bakes and renormalizes normals',
		);

		const [target1, target2] = prim.listTargets();
		deepEqual(
			Array.from(target1.getAttribute('POSITION')!.getArray()!),
			[0, 0, 0, 0, 0, 0, 0, 0, 0],
			'resets target #1 positions',
		);
		deepEqual(
			Array.from(target1.getAttribute('NORMAL')!.getArray()!),
			[0, 0, 0, 0, 0, 0, 0, 0, 0],
			'resets target #1 normals',
		);
		deepEqual(
			Array.from(target2.getAttribute('POSITION')!.getArray()!),
			[0, 0, 0, 0, 0, 0, 0, 0, 0],
			'resets target #2 positions',
		);
		deepEqual(mesh.getWeights(), [0.5, 0.25], 'keeps mesh weights');
	});

	test('node weights override mesh weights', async () => {
		const document = new Document().setLogger(logger);
		const { mesh, prim } = createMorphMesh(document);
		mesh.setWeights([0.5, 0.25]);
		const node = document.createNode().setMesh(mesh).setWeights([1, 0]);
		document.createScene().addChild(node);

		await document.transform(bakeMorphTargets());

		deepEqual(
			Array.from(prim.getAttribute('POSITION')!.getArray()!).map(round(3)),
			// biome-ignore format: Readability.
			[
				0, 0, 1,
				1, 0, 1,
				0, 1, 1,
			],
			'bakes node weights, not mesh weights',
		);
		deepEqual(
			Array.from(prim.getAttribute('NORMAL')!.getArray()!).map(round(3)),
			// biome-ignore format: Readability.
			[
				0, 0.707, 0.707,
				0, 0.707, 0.707,
				0, 0.707, 0.707,
			],
			'bakes and renormalizes normals',
		);
		deepEqual(node.getWeights(), [1, 0], 'keeps node weights');
		deepEqual(mesh.getWeights(), [0.5, 0.25], 'keeps mesh weights');
	});

	test('negative weights', async () => {
		const document = new Document().setLogger(logger);
		const { mesh, prim } = createMorphMesh(document);
		mesh.setWeights([-0.5, 0]);
		document.createScene().addChild(document.createNode().setMesh(mesh));

		await document.transform(bakeMorphTargets());

		deepEqual(
			Array.from(prim.getAttribute('POSITION')!.getArray()!).map(round(3)),
			// biome-ignore format: Readability.
			[
				0, 0, -0.5,
				1, 0, -0.5,
				0, 1, -0.5,
			],
			'bakes negative weights',
		);
		deepEqual(
			Array.from(prim.getAttribute('NORMAL')!.getArray()!).map(round(3)),
			// biome-ignore format: Readability.
			[
				0, -0.447, 0.894,
				0, -0.447, 0.894,
				0, -0.447, 0.894,
			],
			'bakes and renormalizes normals',
		);
	});

	test('shared mesh', async () => {
		const document = new Document().setLogger(logger);
		const { mesh } = createMorphMesh(document);
		const nodeA = document.createNode('A').setMesh(mesh).setWeights([1, 0]);
		const nodeB = document.createNode('B').setMesh(mesh).setWeights([0, 0]);
		document.createScene().addChild(nodeA).addChild(nodeB);

		await document.transform(bakeMorphTargets());

		const meshA = nodeA.getMesh()!;
		const meshB = nodeB.getMesh()!;
		notStrictEqual(meshA, meshB, 'splits mesh for nodes with different weights');
		strictEqual(meshB, mesh, 'node with zero weights keeps original mesh');

		const primA = meshA.listPrimitives()[0];
		const primB = meshB.listPrimitives()[0];

		deepEqual(
			Array.from(primA.getAttribute('POSITION')!.getArray()!).map(round(3)),
			// biome-ignore format: Readability.
			[
				0, 0, 1,
				1, 0, 1,
				0, 1, 1,
			],
			'bakes positions for node A',
		);
		deepEqual(
			Array.from(primB.getAttribute('POSITION')!.getArray()!).map(round(3)),
			// biome-ignore format: Readability.
			[
				0, 0, 0,
				1, 0, 0,
				0, 1, 0,
			],
			'keeps positions for node B',
		);

		const [targetA1, targetA2] = primA.listTargets();
		deepEqual(
			Array.from(targetA1.getAttribute('POSITION')!.getArray()!),
			[0, 0, 0, 0, 0, 0, 0, 0, 0],
			'resets target #1 positions for node A',
		);
		deepEqual(
			Array.from(targetA2.getAttribute('POSITION')!.getArray()!),
			[0, 0, 0, 0, 0, 0, 0, 0, 0],
			'resets target #2 positions for node A',
		);
		deepEqual(nodeA.getWeights(), [1, 0], 'keeps node A weights');

		const [targetB1, targetB2] = primB.listTargets();
		deepEqual(
			Array.from(targetB1.getAttribute('POSITION')!.getArray()!),
			// biome-ignore format: Readability.
			[
				0, 0, 1,
				0, 0, 1,
				0, 0, 1,
			],
			'keeps target #1 positions for node B',
		);
		deepEqual(
			Array.from(targetB2.getAttribute('POSITION')!.getArray()!),
			// biome-ignore format: Readability.
			[
				0, 1, 0,
				0, 0, 0,
				0, 0, 0,
			],
			'keeps target #2 positions for node B',
		);
		deepEqual(nodeB.getWeights(), [0, 0], 'keeps node B weights');

		// Baking again must have no additional effect.
		await document.transform(bakeMorphTargets());

		deepEqual(
			Array.from(primA.getAttribute('POSITION')!.getArray()!).map(round(3)),
			// biome-ignore format: Readability.
			[
				0, 0, 1,
				1, 0, 1,
				0, 1, 1,
			],
			'keeps positions for node A when baked again',
		);
	});

	test('skips zero and missing weights', async () => {
		const document = new Document().setLogger(logger);
		const { mesh, prim } = createMorphMesh(document);
		document.createScene().addChild(document.createNode().setMesh(mesh));

		await document.transform(bakeMorphTargets());

		deepEqual(
			Array.from(prim.getAttribute('POSITION')!.getArray()!),
			// biome-ignore format: Readability.
			[
				0, 0, 0,
				1, 0, 0,
				0, 1, 0,
			],
			'keeps positions without weights',
		);
		deepEqual(
			Array.from(prim.listTargets()[0].getAttribute('POSITION')!.getArray()!),
			// biome-ignore format: Readability.
			[
				0, 0, 1,
				0, 0, 1,
				0, 0, 1,
			],
			'keeps target positions without weights',
		);
	});

	test('skips meshes without morph targets', async () => {
		const document = new Document().setLogger(logger);
		const prim = document.createPrimitive().setAttribute(
			'POSITION',
			document
					.createAccessor()
					.setType('VEC3')
					// biome-ignore format: Readability.
					.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
		);
		const mesh = document.createMesh().addPrimitive(prim);
		document.createScene().addChild(document.createNode().setMesh(mesh).setWeights([1, 0]));

		await document.transform(bakeMorphTargets());

		deepEqual(
			Array.from(prim.getAttribute('POSITION')!.getArray()!),
			[0, 0, 0, 1, 0, 0, 0, 1, 0],
			'keeps positions without morph targets',
		);
	});

	test('warns on animated weights', async () => {
		const warnings: string[] = [];
		const testLogger: ILogger = {
			debug: () => undefined,
			info: () => undefined,
			warn: (text) => void warnings.push(text),
			error: () => undefined,
		};
		const document = new Document().setLogger(testLogger);
		const { mesh } = createMorphMesh(document);
		mesh.setWeights([1, 0]);
		const node = document.createNode('Animated').setMesh(mesh);
		document.createScene().addChild(node);

		const sampler = document
			.createAnimationSampler()
			.setInput(
				document
					.createAccessor()
					.setType('SCALAR')
					.setArray(new Float32Array([0, 1])),
			)
			.setOutput(
				document
					.createAccessor()
					.setType('SCALAR')
					.setArray(new Float32Array([0, 0, 1, 1])),
			);
		const channel = document
			.createAnimationChannel()
			.setTargetNode(node)
			.setTargetPath('weights')
			.setSampler(sampler);
		document.createAnimation().addChannel(channel).addSampler(sampler);

		await document.transform(bakeMorphTargets());

		strictEqual(warnings.length, 1, 'warns once');
	});

	test('tangent', async () => {
		const document = new Document().setLogger(logger);
		const { mesh, prim } = createMorphMesh(document);
		prim.setAttribute(
			'TANGENT',
			document
				.createAccessor()
				.setType('VEC4')
				// biome-ignore format: Readability.
				.setArray(new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1])),
		);
		prim.listTargets()[0].setAttribute(
			'TANGENT',
			document
					.createAccessor()
					.setType('VEC3')
					// biome-ignore format: Readability.
					.setArray(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0])),
		);
		mesh.setWeights([1, 0]);
		document.createScene().addChild(document.createNode().setMesh(mesh));

		await document.transform(bakeMorphTargets());

		deepEqual(
			Array.from(prim.getAttribute('TANGENT')!.getArray()!).map(round(3)),
			// biome-ignore format: Readability.
			[
				0.707, 0.707, 0, 1,
				0.707, 0.707, 0, 1,
				0.707, 0.707, 0, 1,
			],
			'bakes tangents, renormalizes xyz, and preserves w',
		);
		deepEqual(
			Array.from(prim.listTargets()[0].getAttribute('TANGENT')!.getArray()!),
			[0, 0, 0, 0, 0, 0, 0, 0, 0],
			'resets target tangents',
		);
	});
});

/* UTILITIES */

/** Creates a mesh with two morph targets, matching the shared test fixture. */
function createMorphMesh(document: Document): { mesh: Mesh; prim: Primitive } {
	const position = document
		.createAccessor()
		.setType('VEC3')
		// biome-ignore format: Readability.
		.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
	const normal = document
		.createAccessor()
		.setType('VEC3')
		// biome-ignore format: Readability.
		.setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]));

	// Target #1 offsets all vertices by z += 1, and tilts normals to y += 1.
	const target1 = document
		.createPrimitiveTarget()
		.setAttribute(
			'POSITION',
			document
				.createAccessor()
				.setType('VEC3')
				// biome-ignore format: Readability.
				.setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])),
		)
		.setAttribute(
			'NORMAL',
			document
				.createAccessor()
				.setType('VEC3')
				// biome-ignore format: Readability.
				.setArray(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0])),
		);

	// Target #2 offsets only the first vertex by y += 1.
	const target2 = document
		.createPrimitiveTarget()
		.setAttribute(
			'POSITION',
			document
				.createAccessor()
				.setType('VEC3')
				// biome-ignore format: Readability.
				.setArray(new Float32Array([0, 1, 0, 0, 0, 0, 0, 0, 0])),
		)
		.setAttribute(
			'NORMAL',
			document
				.createAccessor()
				.setType('VEC3')
				// biome-ignore format: Readability.
				.setArray(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0])),
		);

	const prim = document
		.createPrimitive()
		.setAttribute('POSITION', position)
		.setAttribute('NORMAL', normal)
		.addTarget(target1)
		.addTarget(target2);
	const mesh = document.createMesh().addPrimitive(prim);

	return { mesh, prim };
}

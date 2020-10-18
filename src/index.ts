
import ts, { ClassElement, SyntaxKind } from 'typescript';
import { compile } from 'vue-template-compiler';

function getFunction(m: ts.FunctionLikeDeclarationBase, s: ts.SourceFile, name?: string) {
	if(!name) name = m.name?.getText(s);
	let body = m.body?.getText(s);
	let param = m.parameters.map(p => p.name.getText(s)).join(",");
	return `${name}(${param})${body}`;
}

function getDecoratorArguments(m: ClassElement, decorator: string, s: ts.SourceFile) {
	if(typeof m.decorators === "undefined") return undefined;
	for(let d of m.decorators) {
		if(ts.isCallExpression(d.expression) &&
			ts.isIdentifier(d.expression.expression) &&
			d.expression.expression.escapedText == decorator) {
			return d.expression.arguments.map(a => a.getText(s));
		}
	}
	return undefined;
}

function getComponentOption(dec: ts.ClassDeclaration): componentOption | undefined {
	if(dec.decorators)
		for(let d of dec.decorators) {
			if(ts.isIdentifier(d.expression) &&
				d.expression.escapedText == "Component") return {};
			if(ts.isCallExpression(d.expression) &&
				ts.isIdentifier(d.expression.expression) &&
				d.expression.expression.escapedText == "Component" &&
				d.expression.arguments.length) {
				let op = d.expression.arguments[0];
				if(ts.isObjectLiteralExpression(op)) {
					let result: componentOption = {};
					for(let p of op.properties) {
						if(ts.isPropertyAssignment(p) &&
							ts.isIdentifier(p.name) &&
							ts.isStringLiteral(p.initializer)) {
							if(p.name.escapedText == "name") result.name = p.initializer.text;
							if(p.name.escapedText == "template") result.template = p.initializer.text;
						}
					}
					return result;
				}
			}
		}
	return undefined;
}

interface componentOption {
	name?: string;
	template?: string;
}

/** Built-in hooks of Vue.js */
var LIFECYCLE_HOOKS = [
	'beforeCreate',
	'created',
	'beforeMount',
	'mounted',
	'beforeUpdate',
	'updated',
	'beforeDestroy',
	'destroyed',
	'activated',
	'deactivated',
	'errorCaptured',
	'serverPrefetch'
];

function findClassDeclaration(statements: readonly ts.Statement[]) {
	for(var s of statements) {
		if(ts.isClassDeclaration(s) &&
			s.modifiers?.some(m => m.kind == ts.SyntaxKind.ExportKeyword) &&
			s.modifiers?.some(m => m.kind == ts.SyntaxKind.DefaultKeyword)) {

			let comOption = getComponentOption(s);
			if(comOption !== undefined) return {
				statement: s,
				option: comOption
			}
		}
	}
	throw new Error("Cannot find class declaration");
}

function classToComponentOptionString(statement: ts.ClassDeclaration, sourceFile: ts.SourceFile): string[] {
	let props: string[] = [];
	let data: string[] = [];
	let watch: string[] = [];
	let computed: string[] = [];
	let methods: string[] = [];
	let events: string[] = [];
	let provides: string[] = [];
	let injects: string[] = [];

	for(let member of statement.members) {
		if(!member.name) continue;

		let name = member.name.getText(sourceFile);
		if(ts.isPropertyDeclaration(member)) {
			let ini = member.initializer;
			let init = ini ? ini.getText(sourceFile) : "undefined";
			let prop = getDecoratorArguments(member, "Prop", sourceFile);
			let inject = getDecoratorArguments(member, "Inject", sourceFile);
			if(prop) {
				if(ini) props.push(`${name}:{type:${prop[0]},default:${init}}`);
				else props.push(`${name}:${prop[0]}`);
			} else if(inject !== undefined) {
				if(!inject.length) inject[0] = `'${name}'`;
				injects.push(`${name}: ${inject[0]}`);
			} else {
				data.push(`${name}:${init}`);
				let provide = getDecoratorArguments(member, "Provide", sourceFile);
				if(provide) provides.push(`${provide}: this.${name}`);
			}
		}
		if(ts.isGetAccessor(member)) {
			computed.push(getFunction(member, sourceFile));
		}
		if(ts.isMethodDeclaration(member)) {
			let func = getFunction(member, sourceFile);
			if(member.modifiers) for(let mod of member.modifiers) {
				if(mod.kind == SyntaxKind.AsyncKeyword) {
					func = "async " + func;
					break;
				}
			}
			let tag = getDecoratorArguments(member, "Watch", sourceFile);
			if(tag) watch.push(getFunction(member, sourceFile, tag[0]));
			else {
				if(LIFECYCLE_HOOKS.includes(name)) events.push(func);
				else methods.push(func);
			}
		}
	}

	let options: string[] = [];

	if(data.length) options.push(`data() { return { ${data.join(",")} }; }`);
	if(props.length) options.push(`props: { ${props.join(",")} }`);
	if(provides.length) options.push(`provide() { return { ${provides.join(",")} }; }`);
	if(injects.length) options.push(`inject: { ${injects.join(",")} }`);
	if(watch.length) options.push(`watch: { ${watch.join(",")} }`);
	if(computed.length) options.push(`computed: { ${computed.join(",")} }`);
	if(methods.length) options.push(`methods: { ${methods.join(",")} }`);
	options.push(...events);

	return options;
}

/**
 * Transpile the default exported class to Vue component global registration.
 * @param code Original Typescript code.
 */
function VPDtoJs(code: string, template: string): string {
	var sourceFile = ts.createSourceFile("vue.ts", code, ts.ScriptTarget.ESNext, false);

	var { statement, option } = findClassDeclaration(sourceFile.statements);

	let comName = "name" in option ? option.name : statement.name?.escapedText.toString().toLowerCase();
	if(!comName) throw new Error("Component needs to have a name");

	let options = classToComponentOptionString(statement, sourceFile);

	if(template) {
		let com = compile(template);
		if(com.staticRenderFns.length > 0) {
			let fns = com.staticRenderFns.map(f => `function(){${f}}`).join(",");
			options.unshift(`staticRenderFns: [ ${fns} ]`);
		}
		options.unshift(`render() { ${com.render} }`);
	} else if('template' in option) {
		options.unshift(`template: '#${comName}'`);
	} else if(option.template) {
		options.unshift(`template: '${option.template}'`);
	} else {
		throw new Error("Cannot resolve template");
	}

	// Put into Vue component syntax
	let output = `Vue.component('${comName}', { ${options.join(",")} });`;

	// Transpile into JavaScript
	output = ts.transpile(output, { target: ts.ScriptTarget.ESNext });
	return output;
}

export = VPDtoJs;
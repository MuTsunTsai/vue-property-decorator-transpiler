
import ts, { ClassElement } from "typescript";

function getFunction(m: ts.FunctionLikeDeclarationBase, s: ts.SourceFile, name?: string) {
	if(!name) name = m.name.getText(s);
	let body = m.body.getText(s);
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

function getComponentOption(dec: ts.ClassDeclaration): componentOption {
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

interface TranspileResult {
	/** Resulting script. */
	script: string;

	/** The ID of the template. */
	template: string;
}

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

/**
 * Transpile the default exported class to Vue component global registration.
 * @param code Original Typescript code.
 */
function VPDtoJs(code: string): TranspileResult {
	var sourceFile = ts.createSourceFile("vue.ts", code, ts.ScriptTarget.ESNext, false);

	for(var s of sourceFile.statements) {
		if(ts.isClassDeclaration(s) &&
			s.modifiers.some(m => m.kind == ts.SyntaxKind.ExportKeyword) &&
			s.modifiers.some(m => m.kind == ts.SyntaxKind.DefaultKeyword)) {

			let comOption = getComponentOption(s);

			let comName = "name" in comOption ? comOption.name : s.name.escapedText.toString().toLowerCase();
			let template = "template" in comOption ? comOption.template : `#${comName}`;
			let match = template.match(/^#(.+)$/);
			let templateName = match ? match[1] : comName;
			let props: string[] = [];
			let data: string[] = [];
			let watch: string[] = [];
			let computed: string[] = [];
			let methods: string[] = [];
			let events: string[] = [];
			let provides: string[] = [];
			let injects: string[] = [];

			for(let m of s.members) {
				let name = m.name.getText(sourceFile);
				if(ts.isPropertyDeclaration(m)) {
					let ini = m.initializer;
					let init = ini ? ini.getText(sourceFile) : "undefined";
					let prop = getDecoratorArguments(m, "Prop", sourceFile);
					let inject = getDecoratorArguments(m, "Inject", sourceFile);
					if(prop) {
						if(ini) props.push(`${name}:{type:${prop[0]},default:${init}}`);
						else props.push(`${name}:${prop[0]}`);
					} else if(inject !== undefined) {
						if(!inject.length) inject[0] = `'${name}'`;
						injects.push(`${name}: ${inject[0]}`);
					} else {
						data.push(`${name}:${init}`);
						let provide = getDecoratorArguments(m, "Provide", sourceFile);
						if(provide) provides.push(`${provide}: this.${name}`);
					}
				}
				if(ts.isGetAccessor(m)) {
					computed.push(getFunction(m, sourceFile));
				}
				if(ts.isMethodDeclaration(m)) {
					let func = getFunction(m, sourceFile);
					let tag = getDecoratorArguments(m, "Watch", sourceFile);
					if(tag) watch.push(getFunction(m, sourceFile, tag[0]));
					else {
						if(LIFECYCLE_HOOKS.includes(name)) events.push(func);
						else methods.push(func);
					}
				}
			}

			let options: string[] = [`template: '${template}'`];

			if(data.length) options.push(`data() { return { ${data.join(",")} }; }`);
			if(props.length) options.push(`props: { ${props.join(",")} }`);
			if(provides.length) options.push(`provide() { return { ${provides.join(",")} }; }`);
			if(injects.length) options.push(`inject: { ${injects.join(",")} }`);
			if(watch.length) options.push(`watch: { ${watch.join(",")} }`);
			if(computed.length) options.push(`computed: { ${computed.join(",")} }`);
			if(methods.length) options.push(`methods: { ${methods.join(",")} }`);
			options.push(...events);

			// 統整成 Vue 的元件語法
			let output = `Vue.component('${comName}', { ${options.join(",")} });`;
			// 轉換成 JavaScript
			output = ts.transpile(output, { target: ts.ScriptTarget.ESNext });
			return { script: output, template: templateName };
		}
	}
}

export = VPDtoJs;
import { Injectable } from '@angular/core'

export interface ConfigFix {
	id: string
	error: any
	path: string
	description: string
	suggestion: {
		operation: 'add' | 'remove' | 'replace' | 'set'
		path: string
		value?: any
		oldValue?: any
	}
}

@Injectable({
	providedIn: 'root',
})
export class ConfigFixService {
	/**
	 * Generates fix suggestions from JSON schema validation errors
	 */
	generateFixes(errors: any[], config: any): ConfigFix[] {
		const fixes: ConfigFix[] = []
		const processedPaths = new Set<string>()

		for (const error of errors) {
			const path = this.getErrorPath(error)
			const pathKey = `${error.keyword}:${path}`

			// Avoid duplicate fixes for the same path/keyword combination
			if (processedPaths.has(pathKey)) {
				continue
			}

			const fix = this.generateFixForError(error, config, path)
			if (fix) {
				fixes.push(fix)
				processedPaths.add(pathKey)
			}
		}

		return fixes
	}

	/**
	 * Gets the JSON path from an error object
	 */
	private getErrorPath(error: any): string {
		if (error.instancePath) {
			return error.instancePath
		}
		if (error.dataPath) {
			return error.dataPath
		}
		return ''
	}

	/**
	 * Generates a fix suggestion for a specific error
	 */
	private generateFixForError(error: any, config: any, path: string): ConfigFix | null {
		const id = `${error.keyword}-${path}-${Date.now()}-${Math.random()}`
		let suggestion: ConfigFix['suggestion'] | null = null
		let description = ''

		// Navigate to the object at the path
		const pathParts = path.split('/').filter((p) => p)
		let currentValue: any = config
		for (const part of pathParts) {
			if (currentValue && typeof currentValue === 'object') {
				// Handle array indices
				if (Array.isArray(currentValue) && /^\d+$/.test(part)) {
					currentValue = currentValue[parseInt(part)]
				} else {
					currentValue = currentValue[part]
				}
			} else {
				currentValue = undefined
				break
			}
		}

		switch (error.keyword) {
			case 'required':
				// Missing required property
				const missingProperty = error.params.missingProperty
				const fullPath = path ? `${path}/${missingProperty}` : `/${missingProperty}`
				const defaultValue = this.getDefaultValue(error, missingProperty)
				suggestion = {
					operation: 'add',
					path: fullPath,
					value: defaultValue,
				}
				description = `Missing required property "${missingProperty}". Add with default value.`
				break

			case 'type':
				// Wrong type - try to convert or set to default
				const expectedType = error.params.type
				const convertedValue = this.convertType(currentValue, expectedType)
				if (convertedValue !== undefined) {
					suggestion = {
						operation: 'replace',
						path: path,
						value: convertedValue,
						oldValue: currentValue,
					}
					description = `Property has wrong type (expected ${expectedType}). Convert value.`
				} else {
					const defaultVal = this.getDefaultValue(error, pathParts[pathParts.length - 1] || '')
					suggestion = {
						operation: 'replace',
						path: path,
						value: defaultVal,
						oldValue: currentValue,
					}
					description = `Property has wrong type (expected ${expectedType}). Set to default value.`
				}
				break

			case 'additionalProperties':
				// Invalid additional property - remove it
				const invalidProperty = error.params.additionalProperty
				const removePath = path ? `${path}/${invalidProperty}` : `/${invalidProperty}`
				suggestion = {
					operation: 'remove',
					path: removePath,
					oldValue: currentValue?.[invalidProperty],
				}
				description = `Invalid property "${invalidProperty}" is not allowed. Remove it.`
				break

			case 'minItems':
				// Array has too few items - can't auto-fix, but we can suggest
				description = `Array must have at least ${error.params.limit} items.`
				return null // Can't auto-fix this

			case 'maxItems':
				// Array has too many items - remove excess
				if (Array.isArray(currentValue) && currentValue.length > error.params.limit) {
					suggestion = {
						operation: 'replace',
						path: path,
						value: currentValue.slice(0, error.params.limit),
						oldValue: currentValue,
					}
					description = `Array has too many items (max ${error.params.limit}). Remove excess items.`
				}
				break

			case 'minLength':
				// String too short - can't auto-fix
				description = `String must be at least ${error.params.limit} characters long.`
				return null

			case 'maxLength':
				// String too long - truncate
				if (typeof currentValue === 'string' && currentValue.length > error.params.limit) {
					suggestion = {
						operation: 'replace',
						path: path,
						value: currentValue.substring(0, error.params.limit),
						oldValue: currentValue,
					}
					description = `String is too long (max ${error.params.limit} characters). Truncate.`
				}
				break

			case 'minimum':
				// Number too small - set to minimum
				if (typeof currentValue === 'number' && currentValue < error.params.limit) {
					suggestion = {
						operation: 'replace',
						path: path,
						value: error.params.limit,
						oldValue: currentValue,
					}
					description = `Value is too small (minimum ${error.params.limit}). Set to minimum.`
				}
				break

			case 'maximum':
				// Number too large - set to maximum
				if (typeof currentValue === 'number' && currentValue > error.params.limit) {
					suggestion = {
						operation: 'replace',
						path: path,
						value: error.params.limit,
						oldValue: currentValue,
					}
					description = `Value is too large (maximum ${error.params.limit}). Set to maximum.`
				}
				break

			case 'enum':
				// Invalid enum value - can't auto-fix without knowing which to choose
				description = `Value must be one of: ${error.params.allowedValues.join(', ')}.`
				return null

			default:
				description = `Validation error: ${error.message || error.keyword}`
				return null
		}

		if (!suggestion) {
			return null
		}

		return {
			id,
			error,
			path,
			description,
			suggestion,
		}
	}

	/**
	 * Converts a value to the expected type
	 */
	private convertType(value: any, expectedType: string): any {
		if (expectedType === 'string') {
			return String(value)
		} else if (expectedType === 'number') {
			const num = Number(value)
			return isNaN(num) ? undefined : num
		} else if (expectedType === 'boolean') {
			if (typeof value === 'string') {
				return value.toLowerCase() === 'true'
			}
			return Boolean(value)
		} else if (expectedType === 'array') {
			if (Array.isArray(value)) {
				return value
			}
			return [value]
		} else if (expectedType === 'object') {
			if (typeof value === 'object' && value !== null) {
				return value
			}
			return {}
		}
		return undefined
	}

	/**
	 * Gets a default value based on the schema error
	 */
	private getDefaultValue(error: any, propertyName: string): any {
		// Try to get default from schema
		if (error.schema?.default !== undefined) {
			return error.schema.default
		}

		// Try to get default from parent schema properties
		if (error.parentSchema?.properties?.[propertyName]?.default !== undefined) {
			return error.parentSchema.properties[propertyName].default
		}

		// Type-based defaults
		const type = error.params?.type || error.schema?.type
		switch (type) {
			case 'string':
				return ''
			case 'number':
				return 0
			case 'boolean':
				return false
			case 'array':
				return []
			case 'object':
				return {}
			default:
				return null
		}
	}

	/**
	 * Applies a fix to the config
	 */
	applyFix(config: any, fix: ConfigFix): any {
		const configCopy = JSON.parse(JSON.stringify(config))
		const pathParts = fix.suggestion.path.split('/').filter((p) => p)

		if (fix.suggestion.operation === 'remove') {
			this.removeProperty(configCopy, pathParts)
		} else if (fix.suggestion.operation === 'add' || fix.suggestion.operation === 'replace' || fix.suggestion.operation === 'set') {
			this.setProperty(configCopy, pathParts, fix.suggestion.value)
		}

		return configCopy
	}

	/**
	 * Removes a property from the config
	 */
	private removeProperty(obj: any, pathParts: string[]): void {
		if (pathParts.length === 0) return

		const lastPart = pathParts[pathParts.length - 1]
		const parentPath = pathParts.slice(0, -1)
		const parent = this.getNestedObject(obj, parentPath)

		if (parent && typeof parent === 'object') {
			if (Array.isArray(parent) && /^\d+$/.test(lastPart)) {
				parent.splice(parseInt(lastPart), 1)
			} else {
				delete parent[lastPart]
			}
		}
	}

	/**
	 * Sets a property in the config
	 */
	private setProperty(obj: any, pathParts: string[], value: any): void {
		if (pathParts.length === 0) return

		const lastPart = pathParts[pathParts.length - 1]
		const parentPath = pathParts.slice(0, -1)
		const parent = this.getNestedObject(obj, parentPath, true)

		if (parent && typeof parent === 'object') {
			if (Array.isArray(parent) && /^\d+$/.test(lastPart)) {
				const index = parseInt(lastPart)
				if (index >= 0 && index < parent.length) {
					parent[index] = value
				} else if (index === parent.length) {
					parent.push(value)
				}
			} else {
				parent[lastPart] = value
			}
		}
	}

	/**
	 * Gets a nested object from the config, optionally creating missing parents
	 */
	private getNestedObject(obj: any, pathParts: string[], createMissing: boolean = false): any {
		let current = obj

		for (let i = 0; i < pathParts.length; i++) {
			const part = pathParts[i]

			if (Array.isArray(current) && /^\d+$/.test(part)) {
				const index = parseInt(part)
				if (index >= 0 && index < current.length) {
					current = current[index]
				} else {
					return undefined
				}
			} else if (current && typeof current === 'object') {
				if (current[part] === undefined) {
					if (createMissing) {
						// Check if next part is a number (array index)
						const nextPart = pathParts[i + 1]
						current[part] = nextPart && /^\d+$/.test(nextPart) ? [] : {}
					} else {
						return undefined
					}
				}
				current = current[part]
			} else {
				return undefined
			}
		}

		return current
	}

	/**
	 * Generates a diff string for display
	 */
	generateDiff(fix: ConfigFix, config: any): { before: string; after: string; path: string } {
		const beforeConfig = JSON.parse(JSON.stringify(config))
		const afterConfig = this.applyFix(beforeConfig, fix)

		const pathParts = fix.suggestion.path.split('/').filter((p) => p)
		let beforeValue = this.getNestedValue(beforeConfig, pathParts)
		const afterValue = this.getNestedValue(afterConfig, pathParts)

		// Handle undefined values
		if (beforeValue === undefined) {
			if (fix.suggestion.operation === 'add') {
				beforeValue = null // Show as null for new properties
			} else if (fix.suggestion.operation === 'remove') {
				beforeValue = fix.suggestion.oldValue
			}
		}

		return {
			before: beforeValue === undefined ? '(undefined)' : JSON.stringify(beforeValue, null, 2),
			after: afterValue === undefined ? '(undefined)' : JSON.stringify(afterValue, null, 2),
			path: fix.suggestion.path,
		}
	}

	/**
	 * Gets a nested value from the config
	 */
	private getNestedValue(obj: any, pathParts: string[]): any {
		let current = obj

		for (const part of pathParts) {
			if (current && typeof current === 'object') {
				if (Array.isArray(current) && /^\d+$/.test(part)) {
					current = current[parseInt(part)]
				} else {
					current = current[part]
				}
			} else {
				return undefined
			}
		}

		return current
	}
}


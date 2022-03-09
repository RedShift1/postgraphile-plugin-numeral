import numeral from 'numeral';


const nullableIf = (GraphQLNonNull, condition, Type) => condition ? Type : new GraphQLNonNull(Type);

const getComputedColumnDetails = ( build, table, proc ) =>
{
    if (!proc.isStable) return null;
    if (proc.namespaceId !== table.namespaceId) return null;
    if (!proc.name.startsWith(`${table.name}_`)) return null;
    if (proc.argTypeIds.length < 1) return null;
    if (proc.argTypeIds[0] !== table.type.id) return null;

    const argTypes = proc.argTypeIds.reduce((prev, typeId, idx) => {
        if (
            proc.argModes.length === 0 || // all args are `in`
            proc.argModes[idx] === "i" || // this arg is `in`
            proc.argModes[idx] === "b" // this arg is `inout`
        ) {
            prev.push(build.pgIntrospectionResultsByKind.typeById[typeId]);
        }
        return prev;
    }, []);
    if (
        argTypes
            .slice(1)
            .some(type => type.type === "c" && type.class && type.class.isSelectable)
    ) {
        // Accepts two input tables? Skip.
        return null;
    }

    const pseudoColumnName = proc.name.substr(table.name.length + 1);
    return { argTypes, pseudoColumnName };
};

function defaultName(columnName)
{
    return columnName + 'Numeral';
}

export default function(nameFn = defaultName)
{
    return function(builder)
    {
        const { pgSimpleCollections } = builder;

        builder.hook(
            'build',
            (_, build) =>
            {
                const { addType, graphql: { GraphQLScalarType } } = build;

                const GraphQLNumeral = new GraphQLScalarType(
                    {
                        name: 'Numeral',
                        description: 'The `Numeral` scalar type represents a number formatted with Numeral.js.'
                    }
                );

                addType(GraphQLNumeral);

                return _;
            }
        );


        builder.hook(
            'GraphQLObjectType:fields',
            (fields, build, context) => {
                const
                {
                    scope:
                    {
                        isPgRowType,
                        isPgCompoundType,
                        isInputType,
                        pgIntrospection: table,
                    },
                    fieldWithHooks,
                    Self,
                } = context;

                if (
                    isInputType ||
                    !(isPgRowType || isPgCompoundType) ||
                    !table ||
                    table.kind !== "class" ||
                    !table.namespace
                )
                {
                    return fields;
                }

                const {
                    extend,
                    pgIntrospectionResultsByKind: introspectionResultsByKind,
                    inflection,
                    pgOmit: omit,
                    pgMakeProcField: makeProcField,
                    swallowError,
                    describePgEntity,
                    sqlCommentByAddingTags,
                } = build;
                const tableType = table.type;

                if (!tableType)
                    throw new Error("Could not determine the type for this table");

                return extend(
                    fields,
                    introspectionResultsByKind.procedure.reduce(
                        (memo, proc) =>
                        {
                            if (omit(proc, "execute"))
                                return memo;

                            const computedColumnDetails = getComputedColumnDetails(build, table, proc);

                            if (!computedColumnDetails)
                                return memo;

                            if(proc.returnTypeId !== '23')
                                return memo;

                            const { pseudoColumnName } = computedColumnDetails;

                            function makeField(forceList)
                            {
                                const fieldName = nameFn(forceList
                                    ? inflection.computedColumnList(pseudoColumnName, proc, table)
                                    : inflection.computedColumn(pseudoColumnName, proc, table));

                                try
                                {
                                    let field = makeProcField(
                                        fieldName,
                                        proc,
                                        build,
                                        {
                                            fieldWithHooks,
                                            computed: true,
                                            forceList
                                        }
                                    );

                                    const parentResolver = field.resolve;

                                    field =
                                    {
                                        ...field,
                                        type: build.getTypeByName('Numeral'),
                                        resolve(data, args, ctx, info)
                                        {
                                            return numeral(parentResolver(data, args, ctx, info)).format(args.format);
                                        }
                                    };

                                    memo = extend(
                                        memo,
                                        { [fieldName]: field },
                                        `Adding computed column for ${describePgEntity(
                                            proc
                                        )}. You can rename this field with a 'Smart Comment':\n\n  ${sqlCommentByAddingTags(
                                            proc,
                                            { fieldName: "newNameHere" }
                                        )}`
                                    );
                                }
                                catch (e)
                                {
                                    swallowError(e);
                                }
                            }

                            const simpleCollections =
                                proc.tags.simpleCollections || pgSimpleCollections;
                            const hasConnections = simpleCollections !== "only";
                            const hasSimpleCollections =
                                simpleCollections === "only" || simpleCollections === "both";
                            if (!proc.returnsSet || hasConnections) {
                                makeField(false);
                            }
                            if (proc.returnsSet && hasSimpleCollections) {
                                makeField(true);
                            }
                            return memo;
                        },
                        {}
                    ),
                    `Adding computed column to '${Self.name}'`
                );
            },
            ['PgComputedColumns']
        );


        builder.hook(
            "GraphQLObjectType:fields",
            (fields, build, context) =>
            {
                const {
                    extend,
                    pgSql: sql,
                    pg2gqlForType,
                    graphql: { GraphQLNonNull },
                    pgColumnFilter,
                    inflection,
                    pgOmit: omit,
                    pgGetSelectValueForFieldAndTypeAndModifier,
                    describePgEntity,
                    sqlCommentByAddingTags,
                } = build;

                const {
                    scope: { isPgRowType, isPgCompoundType, pgIntrospection: table },
                    fieldWithHooks,
                } = context;

                if (
                    !(isPgRowType || isPgCompoundType) ||
                    !table ||
                    table.kind !== "class"
                ) {
                    return fields;
                }

                return extend(
                    fields,
                    table.attributes.reduce((memo, attr) => {
                        // PERFORMANCE: These used to be .filter(...) calls
                        if (!pgColumnFilter(attr, build, context))
                            return memo;

                        if (omit(attr, "read"))
                            return memo;

                        if(attr.typeId !== '23')
                            return memo;

                        const fieldName = nameFn(inflection.column(attr));

                        if (memo[fieldName])
                        {
                            throw new Error(
                                `Two columns produce the same GraphQL field name '${fieldName}' on class '${table.namespaceName}.${table.name}'; one of them is '${attr.name}'`
                            );
                        }

                        memo = extend(
                            memo,
                            {
                                [fieldName]: fieldWithHooks(
                                    fieldName,
                                    fieldContext => {
                                        const { type, typeModifier } = attr;
                                        const sqlColumn = sql.identifier(attr.name);
                                        const { addDataGenerator } = fieldContext;
                                        const ReturnType = build.getTypeByName('Numeral');

                                        addDataGenerator(
                                            parsedResolveInfoFragment =>
                                            {
                                                return {
                                                    pgQuery: queryBuilder =>
                                                    {
                                                        queryBuilder.select(
                                                            pgGetSelectValueForFieldAndTypeAndModifier(
                                                                ReturnType,
                                                                fieldContext,
                                                                parsedResolveInfoFragment,
                                                                sql.fragment`(${queryBuilder.getTableAlias()}.${sqlColumn})`, // The brackets are necessary to stop the parser getting confused, ref: https://www.postgresql.org/docs/9.6/static/rowtypes.html#ROWTYPES-ACCESSING
                                                                type,
                                                                typeModifier
                                                            ),
                                                            fieldName
                                                        );
                                                    },
                                                };
                                            }
                                        );

                                        const convertFromPg = pg2gqlForType(type);

                                        return {
                                            description: attr.description,
                                            type: nullableIf(
                                                GraphQLNonNull,
                                                !attr.isNotNull &&
                                                !attr.type.domainIsNotNull &&
                                                !attr.tags.notNull,
                                                ReturnType
                                            ),
                                            resolve(data, _args, _ctx, _info)
                                            {
                                                return numeral(convertFromPg(data[fieldName])).format(_args.format);
                                            }
                                        };
                                    },
                                    { pgFieldIntrospection: attr }
                                ),
                            },
                            `Adding field for ${describePgEntity(
                                attr
                            )}. You can rename this field with a 'Smart Comment':\n\n  ${sqlCommentByAddingTags(
                                attr,
                                { name: "newNameHere" }
                            )}`
                        );
                        return memo;
                    }, {}),
                    `Adding columns to '${describePgEntity(table)}'`
                );
            },
            ['PgColumns']
        );


        return builder.hook(
            'GraphQLObjectType:fields:field:args',
            (args, build, context) =>
            {
                if (context.field.type.toString() !== 'Numeral' && context.field.type.toString() !== 'Numeral!')
                    return args;

                if(args['format'] !== undefined)
                    return args;

                return build.extend(
                    args,
                    {
                        format: { type: build.graphql.GraphQLString }
                    },
                    'Adding `format` argument'
                );
            }
        );

    }
}

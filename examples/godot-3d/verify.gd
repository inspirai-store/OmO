extends SceneTree
func _initialize():
 var manifest=JSON.parse_string(FileAccess.get_file_as_string("res://assets/workshop/workshop-export.json"))
 var count=0
 for entry in manifest.entries:
  var resource=load("res://assets/workshop/"+entry.entry)
  if resource==null:
   push_error("Missing resource: "+entry.entry)
   quit(1)
   return
  if resource is PackedScene:
   var node=resource.instantiate()
   node.free()
  count+=1
  for variant in entry.variants:
   if load("res://assets/workshop/"+variant.path)==null:
    push_error("Missing variant")
    quit(1)
    return
   count+=1
 print("WORKSHOP_VERIFIED "+str(count))
 quit(0)

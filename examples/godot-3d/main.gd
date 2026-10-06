extends Node3D
func _ready():
 var camera=Camera3D.new()
 add_child(camera)
 camera.position=Vector3(3,3,6)
 camera.look_at(Vector3(0,0.7,0))
 camera.current=true
 var light=DirectionalLight3D.new()
 light.rotation_degrees=Vector3(-45,-25,0)
 light.light_energy=2.0
 add_child(light)
 var environment=WorldEnvironment.new()
 environment.environment=Environment.new()
 environment.environment.background_mode=Environment.BG_COLOR
 environment.environment.background_color=Color(0.12,0.15,0.13)
 environment.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
 environment.environment.ambient_light_color=Color(0.7,0.75,0.7)
 environment.environment.ambient_light_energy=0.7
 add_child(environment)
 var model_paths=["res://assets/workshop/wooden_crate_02_2k-f82841e9/b254b435/wooden_crate_02_2k.gltf","res://assets/workshop/wooden_crate_02_2k-f82841e9/b254b435/wooden_crate_02_2k-秋季木箱 · 暖木色-2917a1f7-2615-4d30-aeca-65f8c3842ea3-e6d5fe3ee8.gltf","res://assets/workshop/wooden_crate_02_2k-f82841e9/b254b435/wooden_crate_02_2k-旧木箱 · 哑光-4769a7d0-8326-4b88-a84e-382016354e60-a257239240.gltf"]
 for i in range(model_paths.size()):
  var model=load(model_paths[i]).instantiate()
  model.position.x=(i-1)*1.8
  add_child(model)
 var floor=MeshInstance3D.new()
 floor.mesh=PlaneMesh.new()
 floor.mesh.size=Vector2(12,8)
 floor.material_override=load("res://assets/workshop/WoodFloor051_2K-PNG-1a211b48/ecb4111a/variants/db6ed577-5423-411e-a178-210788262653-5725e9888e/material.tres")
 add_child(floor)
 var hero=load("res://assets/workshop/characterMedium-preview-c3403d85/73141fe0/characterMedium-preview.glb").instantiate()
 hero.position=Vector3(0,0,-2)
 add_child(hero)
 var player=hero.find_child("AnimationPlayer",true,false)
 if player and player.get_animation_list().size()>0:
  player.play(player.get_animation_list()[0])
